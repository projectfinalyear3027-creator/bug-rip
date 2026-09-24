/**
 * BUG RIP - Team Realtime Event Service (Fragment 10 & Connection Hardening)
 * 
 * Provides secure, server-authoritative, team-scoped Server-Sent Events (SSE)
 * synchronization for two-member team collaboration and real-time admin monitoring.
 * 
 * Invariants & Guarantees:
 * 1. Team-scoped isolation: Events for Team Alpha are never delivered to Team Beta.
 * 2. Server-derived scope: teamId is strictly derived from the authenticated session.
 * 3. Authoritative connection counts: Admin and participants receive live connection state.
 * 4. Deduplication: Multiple tabs or reconnects from the same participant/session count as 1.
 * 5. SSE Disconnect: Immediate unregistration and notification on browser close/tab close.
 * 6. Heartbeat safety net: Fallback detection if TCP connection drops without graceful FIN.
 * 7. Server restart safety: In-memory registry resets cleanly with zero ghost connections.
 */

import { Request, Response } from 'express';
import { teamRepository } from '../repositories/teamRepository.ts';
import { eventRepository } from '../repositories/eventRepository.ts';
import { leaderboardRealtimeService } from './leaderboardRealtimeService.ts';

export interface TeamClientConnection {
  id: string;
  res: Response;
  sessionId: string;
  teamId: string;
  participantId?: string;
  connectedAt: Date;
  lastHeartbeatAt: Date;
  pingInterval?: NodeJS.Timeout;
  closed?: boolean;
}

export class TeamRealtimeService {
  private teamClients: Map<string, Set<TeamClientConnection>> = new Map();
  private allClients: Map<string, TeamClientConnection> = new Map();
  private sessionConnections: Map<string, Set<TeamClientConnection>> = new Map();
  private participantConnections: Map<string, Set<TeamClientConnection>> = new Map();
  private adminClients: Set<Response> = new Set();
  private heartbeatFallbackSessions: Map<string, { teamId: string; participantId?: string; lastHeartbeatAt: Date }> = new Map();
  private safetyNetTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.startSafetyNet();
  }

  private startSafetyNet() {
    if (this.safetyNetTimer) return;
    this.safetyNetTimer = setInterval(() => {
      this.pruneStaleConnections();
    }, 10000);

    if (this.safetyNetTimer.unref) {
      this.safetyNetTimer.unref();
    }
  }

  /**
   * Register a new authenticated participant SSE connection
   */
  async registerClient(params: {
    req?: Request;
    res: Response;
    sessionId: string;
    teamId: string;
    participantId?: string;
  }): Promise<TeamClientConnection> {
    const { req, res, sessionId, teamId, participantId } = params;
    const connectionId = `conn_${sessionId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date();

    // Periodic keep-alive ping to prevent proxy/browser timeout and detect dead sockets rapidly
    const pingInterval = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        this.unregisterClient(connectionId);
      }
    }, 3000);

    if (pingInterval.unref) {
      pingInterval.unref();
    }

    const connection: TeamClientConnection = {
      id: connectionId,
      res,
      sessionId,
      teamId,
      participantId,
      connectedAt: now,
      lastHeartbeatAt: now,
      pingInterval,
      closed: false,
    };

    // Remove from heartbeat fallback once real SSE client is established
    this.heartbeatFallbackSessions.delete(sessionId);

    // Register into tracking maps
    this.allClients.set(connectionId, connection);

    if (!this.teamClients.has(teamId)) {
      this.teamClients.set(teamId, new Set());
    }
    this.teamClients.get(teamId)!.add(connection);

    if (!this.sessionConnections.has(sessionId)) {
      this.sessionConnections.set(sessionId, new Set());
    }
    this.sessionConnections.get(sessionId)!.add(connection);

    if (participantId) {
      if (!this.participantConnections.has(participantId)) {
        this.participantConnections.set(participantId, new Set());
      }
      this.participantConnections.get(participantId)!.add(connection);
    }

    // Clean up immediately when client disconnects or aborts
    const cleanup = () => {
      this.handleClientDisconnect(connection);
    };

    res.on('close', cleanup);
    res.on('finish', cleanup);
    res.on('error', cleanup);

    if (req) {
      req.on('close', cleanup);
      req.on('aborted', cleanup);
      req.on('error', cleanup);
      if (req.socket) {
        req.socket.on('close', cleanup);
        req.socket.on('error', cleanup);
      }
    }

    // Notify other sessions that connection established
    const activeCount = this.getConnectedMemberCount(teamId);
    teamRepository.getTeamById(teamId).then((team) => {
      const registeredCount = team?.registeredMemberCount ?? 1;
      this.broadcastToTeam(teamId, 'team.member.connected', {
        sessionId,
        participantId,
        connectedCount: activeCount,
        registeredCount,
        message: 'Participant session connected.',
        timestamp: new Date().toISOString(),
      });
    }).catch(() => {});

    // Notify admin monitoring stream immediately
    this.broadcastToAdmin('admin.connection.changed', {
      teamId,
      sessionId,
      participantId,
      status: 'CONNECTED',
      teamConnectedCount: activeCount,
      totalConnectedParticipants: this.getTotalConnectedParticipants(),
      timestamp: new Date().toISOString(),
    });

    // Update public scoreboard
    leaderboardRealtimeService.notifyLeaderboardUpdated().catch(() => {});

    return connection;
  }

  /**
   * Handle clean disconnect or connection loss immediately
   */
  async handleClientDisconnect(conn: TeamClientConnection) {
    if (conn.closed) return;
    conn.closed = true;

    if (conn.pingInterval) {
      clearInterval(conn.pingInterval);
      conn.pingInterval = undefined;
    }

    try {
      if (!conn.res.writableEnded) {
        conn.res.end();
      }
    } catch {}

    // Unlink from all internal maps immediately
    this.allClients.delete(conn.id);

    const teamSet = this.teamClients.get(conn.teamId);
    if (teamSet) {
      teamSet.delete(conn);
      if (teamSet.size === 0) {
        this.teamClients.delete(conn.teamId);
      }
    }

    const sessSet = this.sessionConnections.get(conn.sessionId);
    if (sessSet) {
      sessSet.delete(conn);
      if (sessSet.size === 0) {
        this.sessionConnections.delete(conn.sessionId);
      }
    }

    if (conn.participantId) {
      const partSet = this.participantConnections.get(conn.participantId);
      if (partSet) {
        partSet.delete(conn);
        if (partSet.size === 0) {
          this.participantConnections.delete(conn.participantId);
        }
      }
    }

    // Clear any fallback for this session so it doesn't linger
    this.heartbeatFallbackSessions.delete(conn.sessionId);

    // Recalculate authoritative counts immediately
    const activeCount = this.getConnectedMemberCount(conn.teamId);
    const totalParticipants = this.getTotalConnectedParticipants();
    const timestamp = new Date().toISOString();

    // 1. Immediately notify Admin monitoring stream (ZERO delay)
    this.broadcastToAdmin('admin.connection.changed', {
      teamId: conn.teamId,
      sessionId: conn.sessionId,
      participantId: conn.participantId,
      status: 'DISCONNECTED',
      teamConnectedCount: activeCount,
      totalConnectedParticipants: totalParticipants,
      timestamp,
    });

    // 2. Immediately notify remaining sessions
    this.broadcastToTeam(conn.teamId, 'team.member.disconnected', {
      sessionId: conn.sessionId,
      participantId: conn.participantId,
      connectedCount: activeCount,
      registeredCount: 1,
      message: 'Participant session disconnected.',
      timestamp,
    });

    // 3. Update public scoreboard
    leaderboardRealtimeService.notifyLeaderboardUpdated().catch(() => {});

    // 4. Record audit log in background asynchronously without blocking real-time notification
    eventRepository.recordAuditLog({
      action: 'PARTICIPANT_SESSION_DISCONNECTED',
      targetType: 'SESSION',
      targetId: conn.sessionId,
      reason: 'Participant SSE connection closed.',
      metadata: { teamId: conn.teamId, participantId: conn.participantId },
    }).catch(() => {});
  }

  /**
   * Unregister client explicitly by connection ID
   */
  unregisterClient(connectionId: string) {
    const conn = this.allClients.get(connectionId);
    if (conn) {
      this.handleClientDisconnect(conn);
    }
  }

  /**
   * Record periodic heartbeat from participant
   */
  recordHeartbeat(sessionId: string) {
    const now = new Date();
    const conns = this.sessionConnections.get(sessionId);
    if (conns) {
      for (const c of conns) {
        c.lastHeartbeatAt = now;
      }
    }
    const fallback = this.heartbeatFallbackSessions.get(sessionId);
    if (fallback) {
      fallback.lastHeartbeatAt = now;
    }
  }

  /**
   * Register a session fallback (used on session creation / testing without SSE)
   */
  registerSessionFallback(sessionId: string, teamId: string, participantId?: string) {
    this.heartbeatFallbackSessions.set(sessionId, {
      teamId,
      participantId,
      lastHeartbeatAt: new Date(),
    });
  }

  /**
   * Unregister a session completely (e.g. on logout / disconnect beacon / termination)
   */
  async unregisterSession(sessionId: string) {
    const fallback = this.heartbeatFallbackSessions.get(sessionId);
    this.heartbeatFallbackSessions.delete(sessionId);

    const conns = this.sessionConnections.get(sessionId);
    if (conns && conns.size > 0) {
      const list = Array.from(conns);
      for (const conn of list) {
        await this.handleClientDisconnect(conn);
      }
    } else if (fallback) {
      // Fallback session was disconnected without active SSE
      const activeCount = this.getConnectedMemberCount(fallback.teamId);
      const totalParticipants = this.getTotalConnectedParticipants();
      const timestamp = new Date().toISOString();

      this.broadcastToAdmin('admin.connection.changed', {
        teamId: fallback.teamId,
        sessionId,
        participantId: fallback.participantId,
        status: 'DISCONNECTED',
        teamConnectedCount: activeCount,
        totalConnectedParticipants: totalParticipants,
        timestamp,
      });

      this.broadcastToTeam(fallback.teamId, 'team.member.disconnected', {
        sessionId,
        participantId: fallback.participantId,
        connectedCount: activeCount,
        registeredCount: 1,
        message: 'Participant session disconnected.',
        timestamp,
      });
    }
  }

  /**
   * Register an admin monitoring SSE client
   */
  registerAdminClient(res: Response) {
    this.adminClients.add(res);

    const cleanup = () => {
      this.adminClients.delete(res);
    };

    res.on('close', cleanup);
    res.on('finish', cleanup);
    res.on('error', cleanup);
  }

  /**
   * Broadcast real-time event to all connected admin control panels
   */
  broadcastToAdmin(eventName: string, payload: any) {
    if (this.adminClients.size === 0) return;

    const message = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of Array.from(this.adminClients)) {
      try {
        client.write(message);
      } catch {
        this.adminClients.delete(client);
      }
    }
  }

  /**
   * Heartbeat Safety Net: Prune connections with no activity for > 25 seconds
   */
  private pruneStaleConnections() {
    const now = Date.now();
    const staleThresholdMs = 25000; // 25 seconds

    // 1. Check active SSE connections
    for (const conn of Array.from(this.allClients.values())) {
      if (now - conn.lastHeartbeatAt.getTime() > staleThresholdMs) {
        this.handleClientDisconnect(conn);
      }
    }

    // 2. Check fallback sessions
    for (const [sessionId, data] of Array.from(this.heartbeatFallbackSessions.entries())) {
      if (now - data.lastHeartbeatAt.getTime() > staleThresholdMs) {
        this.heartbeatFallbackSessions.delete(sessionId);
        const activeCount = this.getConnectedMemberCount(data.teamId);
        this.broadcastToAdmin('admin.connection.changed', {
          teamId: data.teamId,
          sessionId,
          participantId: data.participantId,
          status: 'DISCONNECTED',
          teamConnectedCount: activeCount,
          totalConnectedParticipants: this.getTotalConnectedParticipants(),
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  /**
   * Get authoritative active connected member count for a specific team.
   * Deduplicates by unique session/participant.
   */
  getConnectedMemberCount(teamId: string): number {
    const uniqueSessions = new Set<string>();

    const teamConns = this.teamClients.get(teamId);
    if (teamConns) {
      for (const c of teamConns) {
        if (!c.closed) {
          uniqueSessions.add(c.sessionId);
        }
      }
    }

    const now = Date.now();
    for (const [sessId, data] of this.heartbeatFallbackSessions.entries()) {
      if (data.teamId === teamId && (now - data.lastHeartbeatAt.getTime()) < 25000) {
        uniqueSessions.add(sessId);
      }
    }

    return uniqueSessions.size;
  }

  /**
   * Check if a participant is currently connected
   */
  isParticipantConnected(participantId: string): boolean {
    const conns = this.participantConnections.get(participantId);
    if (conns) {
      for (const c of conns) {
        if (!c.closed) return true;
      }
    }

    const now = Date.now();
    for (const data of this.heartbeatFallbackSessions.values()) {
      if (data.participantId === participantId && (now - data.lastHeartbeatAt.getTime()) < 25000) {
        return true;
      }
    }

    return false;
  }

  /**
   * Forcibly disconnects a participant and terminates all their active SSE connections and sessions.
   * Called when a participant is deactivated/removed by an administrator.
   */
  async disconnectParticipant(participantId: string, reason?: string) {
    // 1. Terminate all active SSE connections for this participant
    const conns = this.participantConnections.get(participantId);
    if (conns && conns.size > 0) {
      const list = Array.from(conns);
      for (const conn of list) {
        try {
          conn.res.write(
            `event: session.terminated\ndata: ${JSON.stringify({
              error: 'Participant registration is inactive.',
              reason: reason || 'Participant removed by administrator.',
              timestamp: new Date().toISOString(),
            })}\n\n`
          );
        } catch {}
        await this.handleClientDisconnect(conn);
      }
    }
    this.participantConnections.delete(participantId);

    // 2. Clear any fallback sessions for this participant
    for (const [sessId, data] of Array.from(this.heartbeatFallbackSessions.entries())) {
      if (data.participantId === participantId) {
        this.heartbeatFallbackSessions.delete(sessId);
        this.broadcastToAdmin('admin.connection.changed', {
          teamId: data.teamId,
          sessionId: sessId,
          participantId,
          status: 'DISCONNECTED',
          teamConnectedCount: this.getConnectedMemberCount(data.teamId),
          totalConnectedParticipants: this.getTotalConnectedParticipants(),
          timestamp: new Date().toISOString(),
        });
      }
    }

    // 3. Broadcast real-time participant deactivation notification to admin monitoring stream
    this.broadcastToAdmin('admin.participant.deactivated', {
      participantId,
      reason: reason || 'Deactivated by administrator.',
      totalConnectedParticipants: this.getTotalConnectedParticipants(),
      timestamp: new Date().toISOString(),
    });
    this.broadcastToAdmin('admin.metrics.updated', {
      reason: 'PARTICIPANT_DEACTIVATED',
      participantId,
      totalConnectedParticipants: this.getTotalConnectedParticipants(),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Check if a session is currently connected
   */
  isSessionConnected(sessionId: string): boolean {
    const conns = this.sessionConnections.get(sessionId);
    if (conns) {
      for (const c of conns) {
        if (!c.closed) return true;
      }
    }

    const fallback = this.heartbeatFallbackSessions.get(sessionId);
    if (fallback) {
      return (Date.now() - fallback.lastHeartbeatAt.getTime()) < 25000;
    }

    return false;
  }

  /**
   * Total unique active connected participants across all teams
   */
  getTotalConnectedParticipants(): number {
    const uniqueSessions = new Set<string>();

    for (const conn of this.allClients.values()) {
      if (!conn.closed) {
        uniqueSessions.add(conn.sessionId);
      }
    }

    const now = Date.now();
    for (const [sessId, data] of this.heartbeatFallbackSessions.entries()) {
      if ((now - data.lastHeartbeatAt.getTime()) < 25000) {
        uniqueSessions.add(sessId);
      }
    }

    return uniqueSessions.size;
  }

  /**
   * Total teams with at least one active connected participant
   */
  getTotalConnectedTeams(): number {
    const teams = new Set<string>();

    for (const conn of this.allClients.values()) {
      if (!conn.closed) {
        teams.add(conn.teamId);
      }
    }

    const now = Date.now();
    for (const data of this.heartbeatFallbackSessions.values()) {
      if ((now - data.lastHeartbeatAt.getTime()) < 25000) {
        teams.add(data.teamId);
      }
    }

    return teams.size;
  }

  /**
   * Get map of teamId -> connected member count
   */
  getConnectionCountsByTeam(): Map<string, number> {
    const teamSessions = new Map<string, Set<string>>();

    for (const [teamId, conns] of this.teamClients.entries()) {
      if (!teamSessions.has(teamId)) {
        teamSessions.set(teamId, new Set());
      }
      const set = teamSessions.get(teamId)!;
      for (const c of conns) {
        if (!c.closed) {
          set.add(c.sessionId);
        }
      }
    }

    const now = Date.now();
    for (const [sessId, data] of this.heartbeatFallbackSessions.entries()) {
      if ((now - data.lastHeartbeatAt.getTime()) < 25000) {
        if (!teamSessions.has(data.teamId)) {
          teamSessions.set(data.teamId, new Set());
        }
        teamSessions.get(data.teamId)!.add(sessId);
      }
    }

    const result = new Map<string, number>();
    for (const [teamId, set] of teamSessions.entries()) {
      if (set.size > 0) {
        result.set(teamId, set.size);
      }
    }
    return result;
  }

  /**
   * Get active connection count for a team (alias for backward compatibility)
   */
  getActiveConnectionCount(teamId: string): number {
    return this.getConnectedMemberCount(teamId);
  }

  /**
   * Send SSE message strictly to all connected sessions of a specific team
   */
  broadcastToTeam(teamId: string, eventName: string, payload: any) {
    const clients = this.teamClients.get(teamId);
    if (!clients || clients.size === 0) return;

    const message = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;

    for (const client of Array.from(clients)) {
      try {
        client.res.write(message);
      } catch (err) {
        this.unregisterClient(client.id);
      }
    }
  }

  /**
   * Send SSE message strictly to connected sessions of a specific participant
   */
  broadcastToParticipant(participantId: string, eventName: string, payload: any) {
    const clients = this.participantConnections.get(participantId);
    if (!clients || clients.size === 0) return;

    const message = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;

    for (const client of Array.from(clients)) {
      try {
        client.res.write(message);
      } catch (err) {
        this.unregisterClient(client.id);
      }
    }
  }

  /**
   * Send SSE message globally to all connected participants across all teams
   * (Used for global event state transitions: NOT_STARTED, RUNNING, PAUSED, ENDED)
   */
  broadcastGlobal(eventName: string, payload: any) {
    const message = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;

    for (const client of Array.from(this.allClients.values())) {
      try {
        client.res.write(message);
      } catch {
        this.unregisterClient(client.id);
      }
    }
  }

  /**
   * Notification: Challenge Completed by Participant
   */
  notifyTeamChallengeCompleted(teamOrParticipantId: string, data: {
    challengeId: string;
    challengeTitle?: string;
    challengeSlug?: string;
    completedBySessionId: string;
    pointsAwarded: number;
    problemsSolved: number;
    totalScore: number;
    unlockedRounds?: string[];
  }) {
    const payload = {
      ...data,
      message: 'Problem completed successfully.',
      timestamp: new Date().toISOString(),
    };

    // Broadcast canonical solo events
    this.broadcastToTeam(teamOrParticipantId, 'challenge.completed', payload);
    this.broadcastToParticipant(teamOrParticipantId, 'challenge.completed', payload);

    this.broadcastToTeam(teamOrParticipantId, 'score.updated', {
      totalScore: data.totalScore,
      pointsAwarded: data.pointsAwarded,
      timestamp: new Date().toISOString(),
    });
    this.broadcastToParticipant(teamOrParticipantId, 'score.updated', {
      totalScore: data.totalScore,
      pointsAwarded: data.pointsAwarded,
      timestamp: new Date().toISOString(),
    });

    this.broadcastToTeam(teamOrParticipantId, 'solved-count.updated', {
      problemsSolved: data.problemsSolved,
      timestamp: new Date().toISOString(),
    });
    this.broadcastToParticipant(teamOrParticipantId, 'solved-count.updated', {
      problemsSolved: data.problemsSolved,
      timestamp: new Date().toISOString(),
    });

    // Backward compatibility for existing listeners without the false teammate message
    this.broadcastToTeam(teamOrParticipantId, 'team.challenge.completed', payload);
    this.broadcastToParticipant(teamOrParticipantId, 'team.challenge.completed', payload);
  }

  /**
   * Notification: Difficulty Tier Unlocked
   */
  notifyTeamDifficultyUnlocked(teamOrParticipantId: string, data: {
    roundSlug?: string;
    roundName?: string;
    unlockedRounds: string[];
  }) {
    const payload = {
      ...data,
      message: data.roundName ? `${data.roundName.toUpperCase()} UNLOCKED.` : 'NEW DIFFICULTY UNLOCKED.',
      timestamp: new Date().toISOString(),
    };

    this.broadcastToTeam(teamOrParticipantId, 'progression.unlocked', payload);
    this.broadcastToParticipant(teamOrParticipantId, 'progression.unlocked', payload);

    this.broadcastToTeam(teamOrParticipantId, 'team.challenge.unlocked', payload);
    this.broadcastToParticipant(teamOrParticipantId, 'team.challenge.unlocked', payload);
  }

  /**
   * Notification: Progress / Score Updated
   */
  notifyTeamProgressUpdated(teamOrParticipantId: string, data: {
    problemsSolved: number;
    totalScore: number;
    unlockedRounds?: string[];
  }) {
    const payload = {
      ...data,
      timestamp: new Date().toISOString(),
    };

    this.broadcastToTeam(teamOrParticipantId, 'score.updated', {
      totalScore: data.totalScore,
      problemsSolved: data.problemsSolved,
      timestamp: new Date().toISOString(),
    });
    this.broadcastToParticipant(teamOrParticipantId, 'score.updated', {
      totalScore: data.totalScore,
      problemsSolved: data.problemsSolved,
      timestamp: new Date().toISOString(),
    });

    this.broadcastToTeam(teamOrParticipantId, 'solved-count.updated', {
      problemsSolved: data.problemsSolved,
      timestamp: new Date().toISOString(),
    });
    this.broadcastToParticipant(teamOrParticipantId, 'solved-count.updated', {
      problemsSolved: data.problemsSolved,
      timestamp: new Date().toISOString(),
    });

    this.broadcastToTeam(teamOrParticipantId, 'team.progress.updated', payload);
    this.broadcastToParticipant(teamOrParticipantId, 'team.progress.updated', payload);
  }

  /**
   * Notification: Member connected
   */
  notifyTeamMemberConnected(teamId: string, data: {
    sessionId: string;
    participantId?: string;
    connectedCount: number;
    registeredCount: number;
  }) {
    this.broadcastToTeam(teamId, 'team.member.connected', {
      ...data,
      message: 'Participant session connected.',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Notification: Member disconnected
   */
  notifyTeamMemberDisconnected(teamId: string, data: {
    sessionId: string;
    connectedCount: number;
    registeredCount: number;
    reason?: string;
  }) {
    this.broadcastToTeam(teamId, 'team.member.disconnected', {
      ...data,
      message: 'Participant session disconnected.',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Notification: Session count updated
   */
  notifyTeamSessionUpdated(teamId: string, data: {
    connectedCount: number;
    registeredCount: number;
  }) {
    this.broadcastToTeam(teamId, 'team.session.updated', {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Reset all clients and state (Used for test isolation and server reboot)
   */
  resetForTesting() {
    for (const conn of Array.from(this.allClients.values())) {
      if (conn.pingInterval) clearInterval(conn.pingInterval);
      try {
        conn.res.end();
      } catch {}
    }
    this.teamClients.clear();
    this.allClients.clear();
    this.sessionConnections.clear();
    this.participantConnections.clear();
    this.heartbeatFallbackSessions.clear();
    for (const admin of this.adminClients) {
      try {
        admin.end();
      } catch {}
    }
    this.adminClients.clear();
  }
}

export const teamRealtimeService = new TeamRealtimeService();

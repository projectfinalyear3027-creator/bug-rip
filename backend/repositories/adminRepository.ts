/**
 * BUG RIP - Admin & Organizer Repository
 * Backed strictly by PostgreSQL / PGlite database.
 * Handles admin authentication, sessions, audit logging, team/participant monitoring, and event controls.
 */

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { eq, and, gt, desc, sql, count, inArray, or } from 'drizzle-orm';
import { db } from '../../src/db/index.ts';
import {
  adminUsers,
  adminSessions,
  auditLogs,
  eventSettings,
  teams,
  participants,
  teamMembers,
  sessions,
  challenges,
  teamChallenges,
  participantChallenges,
  participantUnlockedRounds,
  competitionMatches,
  matchHistoricalChallenges,
  teamUnlockedRounds,
  progressionOverrides,
  antiCheatEvents,
} from '../../src/db/schema.ts';
import { teamRealtimeService } from '../services/teamRealtimeService.ts';
import { leaderboardRealtimeService } from '../services/leaderboardRealtimeService.ts';
import { eventRepository } from './eventRepository.ts';

export interface AdminUserRecord {
  id: string;
  username: string;
  displayName: string;
  role: 'ADMIN' | 'SUPER_ADMIN';
  isActive: boolean;
  lastLoginAt: Date | null;
}

export interface AdminSessionRecord {
  id: string;
  adminUserId: string;
  sessionTokenHash: string;
  status: string;
  expiresAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
  adminUser: AdminUserRecord;
}

export class AdminRepository {
  private static isCreatingMatchLock = false;

  /**
   * Hashes an admin session token for storage.
   */
  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token.trim()).digest('hex');
  }

  /**
   * Generates a cryptographically strong session token.
   */
  generateSessionToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Verifies admin credentials against the database.
   * Returns admin user on success, or null on invalid credentials.
   * Never leaks whether the username exists.
   */
  async verifyAdminCredentials(
    rawUsername: string,
    rawPassword: string
  ): Promise<AdminUserRecord | null> {
    if (!rawUsername || !rawPassword) return null;

    const username = rawUsername.trim();
    const password = rawPassword;

    const matchedUsers = await db
      .select()
      .from(adminUsers)
      .where(and(eq(adminUsers.username, username), eq(adminUsers.isActive, true)))
      .limit(1);

    if (matchedUsers.length === 0) {
      return null;
    }

    const user = matchedUsers[0];

    // Verify using bcrypt
    let isPasswordValid = false;
    try {
      isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    } catch {
      isPasswordValid = false;
    }

    // Fallback check for legacy sha256 hash (and upgrade if matched)
    if (!isPasswordValid) {
      const sha256Hash = crypto.createHash('sha256').update(password).digest('hex');
      if (user.passwordHash === sha256Hash) {
        isPasswordValid = true;
        // Upgrade hash to bcrypt asynchronously
        const newBcryptHash = await bcrypt.hash(password, 10);
        await db
          .update(adminUsers)
          .set({ passwordHash: newBcryptHash })
          .where(eq(adminUsers.id, user.id));
      }
    }

    if (!isPasswordValid) {
      return null;
    }

    // Update lastLoginAt
    await db
      .update(adminUsers)
      .set({ lastLoginAt: new Date() })
      .where(eq(adminUsers.id, user.id));

    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
    };
  }

  /**
   * Creates an authenticated admin session in the database.
   */
  async createAdminSession(
    adminUserId: string,
    options?: { userAgent?: string; ipAddress?: string; durationHours?: number }
  ): Promise<{ sessionToken: string; session: AdminSessionRecord }> {
    const rawToken = this.generateSessionToken();
    const tokenHash = this.hashToken(rawToken);

    const durationHours = options?.durationHours || 8;
    const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);

    const inserted = await db
      .insert(adminSessions)
      .values({
        adminUserId,
        sessionTokenHash: tokenHash,
        status: 'ACTIVE',
        expiresAt,
        userAgent: options?.userAgent || null,
        ipAddress: options?.ipAddress || null,
      })
      .returning();

    const userRecords = await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, adminUserId))
      .limit(1);

    const user = userRecords[0];

    return {
      sessionToken: rawToken,
      session: {
        id: inserted[0].id,
        adminUserId: inserted[0].adminUserId,
        sessionTokenHash: inserted[0].sessionTokenHash,
        status: inserted[0].status,
        expiresAt: inserted[0].expiresAt,
        userAgent: inserted[0].userAgent,
        ipAddress: inserted[0].ipAddress,
        adminUser: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          role: user.role,
          isActive: user.isActive,
          lastLoginAt: user.lastLoginAt,
        },
      },
    };
  }

  /**
   * Validates an admin session token hash.
   * Returns full admin session + user record, or null if invalid/expired.
   */
  async validateAdminSession(rawToken: string): Promise<AdminSessionRecord | null> {
    if (!rawToken) return null;

    const tokenHash = this.hashToken(rawToken);
    const now = new Date();

    const rows = await db
      .select({
        sessionId: adminSessions.id,
        adminUserId: adminSessions.adminUserId,
        sessionTokenHash: adminSessions.sessionTokenHash,
        status: adminSessions.status,
        expiresAt: adminSessions.expiresAt,
        userAgent: adminSessions.userAgent,
        ipAddress: adminSessions.ipAddress,
        userId: adminUsers.id,
        username: adminUsers.username,
        displayName: adminUsers.displayName,
        role: adminUsers.role,
        isActive: adminUsers.isActive,
        lastLoginAt: adminUsers.lastLoginAt,
      })
      .from(adminSessions)
      .innerJoin(adminUsers, eq(adminSessions.adminUserId, adminUsers.id))
      .where(
        and(
          eq(adminSessions.sessionTokenHash, tokenHash),
          eq(adminSessions.status, 'ACTIVE'),
          gt(adminSessions.expiresAt, now),
          eq(adminUsers.isActive, true)
        )
      )
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];

    // Update last activity timestamp asynchronously
    db.update(adminSessions)
      .set({ lastActivityAt: now })
      .where(eq(adminSessions.id, row.sessionId))
      .catch(() => {});

    return {
      id: row.sessionId,
      adminUserId: row.adminUserId,
      sessionTokenHash: row.sessionTokenHash,
      status: row.status,
      expiresAt: row.expiresAt,
      userAgent: row.userAgent,
      ipAddress: row.ipAddress,
      adminUser: {
        id: row.userId,
        username: row.username,
        displayName: row.displayName,
        role: row.role,
        isActive: row.isActive,
        lastLoginAt: row.lastLoginAt,
      },
    };
  }

  /**
   * Revokes an admin session (on logout).
   */
  async revokeAdminSession(rawToken: string): Promise<boolean> {
    if (!rawToken) return false;
    const tokenHash = this.hashToken(rawToken);

    const result = await db
      .update(adminSessions)
      .set({ status: 'REVOKED' })
      .where(eq(adminSessions.sessionTokenHash, tokenHash))
      .returning({ id: adminSessions.id });

    return result.length > 0;
  }

  /**
   * Helper to safely resolve a valid admin user UUID from the database,
   * avoiding foreign key violations when using developer fallback tokens or synthetic IDs.
   */
  async resolveAdminUserId(adminUserId?: string | null, tx?: any): Promise<string | null> {
    if (!adminUserId) return null;
    try {
      const client = tx || db;
      const found = await client
        .select({ id: adminUsers.id })
        .from(adminUsers)
        .where(eq(adminUsers.id, adminUserId))
        .limit(1);
      if (found.length > 0) return found[0].id;
      const first = await client
        .select({ id: adminUsers.id })
        .from(adminUsers)
        .where(eq(adminUsers.isActive, true))
        .limit(1);
      return first[0]?.id || null;
    } catch {
      return null;
    }
  }

  /**
   * Records an audit log entry in the audit_logs table.
   */
  async recordAuditLog(
    entry: {
      adminUserId?: string | null;
      action: string;
      targetType?: string;
      targetId?: string;
      reason?: string;
      metadata?: Record<string, any>;
    },
    tx?: any
  ): Promise<void> {
    try {
      const client = tx || db;
      const resolvedAdminId = await this.resolveAdminUserId(entry.adminUserId, client);
      await client.insert(auditLogs).values({
        adminUserId: resolvedAdminId,
        action: entry.action,
        targetType: entry.targetType || null,
        targetId: entry.targetId || null,
        reason: entry.reason || null,
        metadata: entry.metadata || null,
      });
    } catch (err) {
      console.error('Failed to write audit log:', err);
    }
  }

  /**
   * Retrieves audit logs sorted by most recent.
   */
  async getAuditLogs(limit = 100): Promise<any[]> {
    const logs = await db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        targetType: auditLogs.targetType,
        targetId: auditLogs.targetId,
        reason: auditLogs.reason,
        metadata: auditLogs.metadata,
        createdAt: auditLogs.createdAt,
        adminUserId: auditLogs.adminUserId,
        adminUsername: adminUsers.username,
        adminDisplayName: adminUsers.displayName,
      })
      .from(auditLogs)
      .leftJoin(adminUsers, eq(auditLogs.adminUserId, adminUsers.id))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);

    return logs;
  }

  /**
   * Fetches real authoritative dashboard metrics from the database.
   */
  async getDashboardMetrics(): Promise<{
    eventStatus: string;
    durationMinutes: number;
    startedAt: Date | null;
    pausedAt: Date | null;
    endedAt: Date | null;
    registeredTeamsCount: number;
    registeredParticipants: number;
    registeredParticipantsCount: number;
    connectedParticipants: number;
    connectedParticipantsCount: number;
    activeParticipantSessions: number;
    activeParticipantSessionsCount: number;
    participantCount: number;
    activeTeamSessionsCount: number;
    problemsSolvedCount: number;
    currentLeader: string | null;
  }> {
    // 1. Event settings
    const eventRow = await db.select().from(eventSettings).where(eq(eventSettings.id, 1)).limit(1);
    const event = eventRow[0] || {
      status: 'NOT_STARTED',
      durationMinutes: 60,
      startedAt: null,
      pausedAt: null,
      endedAt: null,
    };

    // 2. Teams count (ACTIVE teams only)
    const teamCountRows = await db
      .select({ val: count() })
      .from(teams)
      .where(eq(teams.status, 'ACTIVE'));
    const registeredTeamsCount = Number(teamCountRows[0]?.val || 0);

    // 3. Participants count (ACTIVE participants only)
    const participantCountRows = await db
      .select({ val: count() })
      .from(participants)
      .where(eq(participants.status, 'ACTIVE'));
    const registeredParticipantsCount = Number(participantCountRows[0]?.val || 0);

    // 4. Connected participants (authoritative active live connections)
    const connectedParticipantsCount = teamRealtimeService.getTotalConnectedParticipants();
    const activeTeamSessionsCount = teamRealtimeService.getTotalConnectedTeams();
    const activeParticipantSessions = connectedParticipantsCount;

    // 5. Problems solved across all competitors
    const solvedRows = await db
      .select({ val: count() })
      .from(participantChallenges)
      .where(eq(participantChallenges.status, 'COMPLETED'));
    let problemsSolvedCount = Number(solvedRows[0]?.val || 0);

    if (problemsSolvedCount === 0) {
      const legacySolvedRows = await db
        .select({ val: count() })
        .from(teamChallenges)
        .where(eq(teamChallenges.status, 'COMPLETED'));
      problemsSolvedCount = Number(legacySolvedRows[0]?.val || 0);
    }

    // 6. Current leader (only if solves exist)
    let currentLeader: string | null = null;
    if (problemsSolvedCount > 0) {
      const participantLeaderRows = await db
        .select({
          participantName: participants.name,
          solves: count(participantChallenges.id),
        })
        .from(participants)
        .innerJoin(participantChallenges, eq(participants.id, participantChallenges.participantId))
        .where(
          and(
            eq(participantChallenges.status, 'COMPLETED'),
            eq(participants.status, 'ACTIVE')
          )
        )
        .groupBy(participants.id, participants.name)
        .orderBy(desc(count(participantChallenges.id)))
        .limit(1);

      if (participantLeaderRows.length > 0 && Number(participantLeaderRows[0].solves) > 0) {
        currentLeader = `${participantLeaderRows[0].participantName} (${participantLeaderRows[0].solves} solved)`;
      } else {
        const leaderRows = await db
          .select({
            teamName: teams.teamName,
            solves: count(teamChallenges.id),
          })
          .from(teams)
          .innerJoin(teamChallenges, eq(teams.id, teamChallenges.teamId))
          .where(eq(teamChallenges.status, 'COMPLETED'))
          .groupBy(teams.id, teams.teamName)
          .orderBy(desc(count(teamChallenges.id)))
          .limit(1);

        if (leaderRows.length > 0 && Number(leaderRows[0].solves) > 0) {
          currentLeader = `${leaderRows[0].teamName} (${leaderRows[0].solves} solved)`;
        }
      }
    }

    return {
      eventStatus: event.status,
      durationMinutes: event.durationMinutes,
      startedAt: event.startedAt,
      pausedAt: event.pausedAt,
      endedAt: event.endedAt,
      registeredParticipants: registeredParticipantsCount,
      registeredParticipantsCount,
      connectedParticipants: connectedParticipantsCount,
      connectedParticipantsCount,
      activeParticipantSessions,
      activeParticipantSessionsCount: activeParticipantSessions,
      participantCount: registeredParticipantsCount,
      registeredTeamsCount,
      activeTeamSessionsCount,
      problemsSolvedCount,
      currentLeader,
    };
  }

  /**
   * Fetches real team overviews with real connection counts.
   */
  async getTeamsOverview(): Promise<any[]> {
    const allTeams = await db
      .select({
        id: teams.id,
        teamName: teams.teamName,
        teamCode: teams.teamCode,
        registeredMemberCount: teams.registeredMemberCount,
        status: teams.status,
        createdAt: teams.createdAt,
      })
      .from(teams)
      .orderBy(teams.teamName);

    // Authoritative connection counts from realtime registry
    const connectionCountsByTeam = teamRealtimeService.getConnectionCountsByTeam();

    // Completed challenges
    const solvedRecords = await db
      .select({
        teamId: teamChallenges.teamId,
        score: challenges.score,
      })
      .from(teamChallenges)
      .innerJoin(challenges, eq(teamChallenges.challengeId, challenges.id))
      .where(eq(teamChallenges.status, 'COMPLETED'));

    const solvesByTeam = new Map<string, { count: number; score: number }>();
    for (const s of solvedRecords) {
      const prev = solvesByTeam.get(s.teamId) || { count: 0, score: 0 };
      solvesByTeam.set(s.teamId, {
        count: prev.count + 1,
        score: prev.score + (s.score || 0),
      });
    }

    return allTeams.map((t) => {
      const connectedCount = connectionCountsByTeam.get(t.id) || 0;
      const solves = solvesByTeam.get(t.id) || { count: 0, score: 0 };
      return {
        id: t.id,
        teamName: t.teamName,
        teamCode: t.teamCode,
        registeredMemberCount: t.registeredMemberCount,
        connectedMemberCount: connectedCount,
        connectedMembersCount: connectedCount,
        status: t.status,
        problemsSolved: solves.count,
        totalScore: solves.score,
        createdAt: t.createdAt,
      };
    });
  }

  /**
   * Fetches single team details.
   */
  async getTeamDetails(teamId: string): Promise<any | null> {
    const matched = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    if (matched.length === 0) return null;
    const team = matched[0];

    // Members
    const members = await db
      .select({
        id: participants.id,
        name: participants.name,
        email: participants.email,
        college: participants.college,
        assignedAt: teamMembers.createdAt,
      })
      .from(teamMembers)
      .innerJoin(participants, eq(teamMembers.participantId, participants.id))
      .where(eq(teamMembers.teamId, teamId))
      .orderBy(teamMembers.createdAt);

    // Active sessions - verified through realtime registry
    const dbSessions = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.teamId, teamId),
          eq(sessions.status, 'ACTIVE')
        )
      );

    const activeSessions = dbSessions.filter((s) => teamRealtimeService.isSessionConnected(s.id));
    const connectedMemberCount = teamRealtimeService.getConnectedMemberCount(teamId);

    return {
      id: team.id,
      teamName: team.teamName,
      teamCode: team.teamCode,
      registeredMemberCount: team.registeredMemberCount,
      connectedMemberCount,
      connectedMembersCount: connectedMemberCount,
      status: team.status,
      members,
      activeSessions: activeSessions.map((s) => ({
        id: s.id,
        participantId: s.participantId,
        connectedAt: s.connectedAt,
        lastHeartbeatAt: s.lastHeartbeatAt,
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
      })),
    };
  }

  /**
   * Fetches participants overview for authorized administrators.
   * Supports optional status filter: 'ALL' | 'ACTIVE' | 'INACTIVE'
   */
  async getParticipantsOverview(statusFilter: string = 'ACTIVE'): Promise<any[]> {
    const rows = await db
      .select({
        id: participants.id,
        name: participants.name,
        email: participants.email,
        college: participants.college,
        participantCode: participants.participantCode,
        status: participants.status,
        teamId: teams.id,
        teamName: teams.teamName,
        teamStatus: teams.status,
        createdAt: participants.createdAt,
      })
      .from(participants)
      .leftJoin(teamMembers, eq(participants.id, teamMembers.participantId))
      .leftJoin(teams, eq(teamMembers.teamId, teams.id))
      .orderBy(participants.name);

    // Apply status filter: Defaults to 'ACTIVE'
    const normalizedFilter = (statusFilter || 'ACTIVE').toUpperCase();
    const filteredRows = normalizedFilter === 'ALL'
      ? rows
      : normalizedFilter === 'INACTIVE'
      ? rows.filter((p) => p.status === 'INACTIVE' || p.status === 'DISABLED')
      : rows.filter((p) => p.status === 'ACTIVE' || !p.status);

    // Fetch participant solves & scores
    const solvedRecords = await db
      .select({
        participantId: participantChallenges.participantId,
        score: challenges.score,
      })
      .from(participantChallenges)
      .innerJoin(challenges, eq(participantChallenges.challengeId, challenges.id))
      .where(eq(participantChallenges.status, 'COMPLETED'));

    const solvesByParticipant = new Map<string, { count: number; score: number }>();
    for (const s of solvedRecords) {
      const prev = solvesByParticipant.get(s.participantId) || { count: 0, score: 0 };
      solvesByParticipant.set(s.participantId, {
        count: prev.count + 1,
        score: prev.score + (s.score || 0),
      });
    }

    // Fetch latest session per participant
    const sessionRecords = await db
      .select({
        participantId: sessions.participantId,
        status: sessions.status,
        lastHeartbeatAt: sessions.lastHeartbeatAt,
      })
      .from(sessions)
      .orderBy(desc(sessions.lastHeartbeatAt));

    const latestSessionByParticipant = new Map<string, { status: string; lastHeartbeatAt: Date }>();
    for (const s of sessionRecords) {
      if (s.participantId && !latestSessionByParticipant.has(s.participantId)) {
        latestSessionByParticipant.set(s.participantId, {
          status: s.status,
          lastHeartbeatAt: s.lastHeartbeatAt,
        });
      }
    }

    // Fetch anti-cheat events per team
    const acEvents = await db
      .select({
        teamId: antiCheatEvents.teamId,
      })
      .from(antiCheatEvents);
    const incidentCountsByTeam = new Map<string, number>();
    for (const ac of acEvents) {
      if (ac.teamId) {
        incidentCountsByTeam.set(ac.teamId, (incidentCountsByTeam.get(ac.teamId) || 0) + 1);
      }
    }

    return filteredRows.map((p) => {
      const isConnected = teamRealtimeService.isParticipantConnected(p.id);
      const solves = solvesByParticipant.get(p.id) || { count: 0, score: 0 };
      const sess = latestSessionByParticipant.get(p.id);
      const violationsCount = p.teamId ? (incidentCountsByTeam.get(p.teamId) || 0) : 0;
      const isActive = p.status === 'ACTIVE' || !p.status;

      return {
        id: p.id,
        name: p.name,
        email: p.email || '—',
        college: p.college || 'Not Specified',
        participantCode: p.participantCode || p.teamName || '—',
        teamName: p.name, // in solo competition, competitor name is primary
        status: isActive ? 'ACTIVE' : 'INACTIVE',
        registrationStatus: isActive ? 'CONFIRMED' : 'INACTIVE',
        connectionStatus: isConnected ? 'CONNECTED' : 'DISCONNECTED',
        sessionStatus: isConnected ? 'ACTIVE' : (sess?.status || 'NONE'),
        lastHeartbeat: isConnected ? new Date().toISOString() : (sess?.lastHeartbeatAt ? new Date(sess.lastHeartbeatAt).toISOString() : null),
        antiCheatStatus: violationsCount > 0 ? `${violationsCount} FLAG(S)` : 'CLEAR',
        violationsCount,
        problemsSolved: solves.count,
        totalScore: solves.score,
        lastActivity: isConnected ? new Date() : (sess?.lastHeartbeatAt || p.createdAt),
      };
    });
  }

  /**
   * Safe Admin Participant Removal (Deactivation)
   * 
   * Invariants:
   * 1. Only permitted when competition status is NOT_STARTED.
   * 2. Preserves all historical records, solves, and anti-cheat logs (soft-deactivation).
   * 3. Sets participant status to 'INACTIVE'.
   * 4. Invalidates all active sessions for this participant.
   * 5. Forcibly terminates active realtime connections.
   * 6. Creates an immutable audit log entry.
   */
  async deactivateParticipant(
    participantId: string,
    adminUserId: string,
    reason?: string
  ): Promise<{
    success: boolean;
    statusCode: number;
    error?: string;
    message?: string;
    participant?: any;
  }> {
    // 1. Guard competition status: Only NOT_STARTED allows participant removal
    const eventRow = await db.select().from(eventSettings).where(eq(eventSettings.id, 1)).limit(1);
    const currentStatus = eventRow[0]?.status || 'NOT_STARTED';
    if (currentStatus !== 'NOT_STARTED') {
      return {
        success: false,
        statusCode: 409,
        error: `Participant removal is only permitted when competition is in NOT_STARTED state. Current competition status is ${currentStatus}.`,
      };
    }

    // 2. Lookup participant
    const [participant] = await db
      .select()
      .from(participants)
      .where(eq(participants.id, participantId))
      .limit(1);

    if (!participant) {
      return {
        success: false,
        statusCode: 404,
        error: 'Participant not found.',
      };
    }

    // 3. Atomically update status, invalidate sessions, and write audit log
    await db.transaction(async (tx) => {
      // Soft-deactivate participant
      await tx
        .update(participants)
        .set({
          status: 'INACTIVE',
          updatedAt: new Date(),
        })
        .where(eq(participants.id, participantId));

      // Find any associated solo team and disable it
      const memberRows = await tx
        .select({ teamId: teamMembers.teamId })
        .from(teamMembers)
        .where(eq(teamMembers.participantId, participantId));

      const teamIds = memberRows.map((r) => r.teamId);
      if (teamIds.length > 0) {
        await tx
          .update(teams)
          .set({
            status: 'DISABLED',
            updatedAt: new Date(),
          })
          .where(inArray(teams.id, teamIds));
      }

      // Invalidate active sessions
      const activeSessions = await tx
        .select({ id: sessions.id })
        .from(sessions)
        .where(
          and(
            eq(sessions.status, 'ACTIVE'),
            or(
              eq(sessions.participantId, participantId),
              teamIds.length > 0 ? inArray(sessions.teamId, teamIds) : sql`false`
            )
          )
        );

      if (activeSessions.length > 0) {
        await tx
          .update(sessions)
          .set({
            status: 'EXPIRED',
            disconnectedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            inArray(
              sessions.id,
              activeSessions.map((s) => s.id)
            )
          );
      }

      // Immutable audit log
      await tx.insert(auditLogs).values({
        adminUserId,
        action: 'PARTICIPANT_DEACTIVATED',
        targetType: 'PARTICIPANT',
        targetId: participant.id,
        reason: reason?.trim() || 'Participant removed/deactivated by administrator.',
        metadata: {
          participantId: participant.id,
          participantName: participant.name,
          participantCode: participant.participantCode,
          email: participant.email || null,
          college: participant.college || null,
          adminUserId,
          reason: reason?.trim() || null,
          timestamp: new Date().toISOString(),
        },
      });
    });

    // 4. Disconnect active realtime connections & notify admin telemetry stream
    try {
      await teamRealtimeService.disconnectParticipant(participantId, reason);
      teamRealtimeService.broadcastToAdmin('admin.metrics.updated', {
        reason: 'PARTICIPANT_DEACTIVATED',
        participantId,
        timestamp: new Date().toISOString(),
      });
      leaderboardRealtimeService.notifyLeaderboardUpdated();
    } catch (err) {
      console.warn('Post-deactivation notification error:', err);
    }

    return {
      success: true,
      statusCode: 200,
      message: `Participant "${participant.name}" has been removed from active registration.`,
      participant: {
        id: participant.id,
        name: participant.name,
        participantCode: participant.participantCode,
        email: participant.email,
        status: 'INACTIVE',
      },
    };
  }

  /**
   * Safe Admin Participant Reactivation
   * 
   * Re-activates a previously deactivated participant while in NOT_STARTED state.
   */
  async reactivateParticipant(
    participantId: string,
    adminUserId: string,
    reason?: string
  ): Promise<{
    success: boolean;
    statusCode: number;
    error?: string;
    message?: string;
    participant?: any;
  }> {
    // 1. Guard competition status
    const eventRow = await db.select().from(eventSettings).where(eq(eventSettings.id, 1)).limit(1);
    const currentStatus = eventRow[0]?.status || 'NOT_STARTED';
    if (currentStatus !== 'NOT_STARTED') {
      return {
        success: false,
        statusCode: 409,
        error: `Participant reactivation is only permitted when competition is in NOT_STARTED state. Current competition status is ${currentStatus}.`,
      };
    }

    // 2. Lookup participant
    const [participant] = await db
      .select()
      .from(participants)
      .where(eq(participants.id, participantId))
      .limit(1);

    if (!participant) {
      return {
        success: false,
        statusCode: 404,
        error: 'Participant not found.',
      };
    }

    // 3. Atomically update status and write audit log
    await db.transaction(async (tx) => {
      await tx
        .update(participants)
        .set({
          status: 'ACTIVE',
          updatedAt: new Date(),
        })
        .where(eq(participants.id, participantId));

      const memberRows = await tx
        .select({ teamId: teamMembers.teamId })
        .from(teamMembers)
        .where(eq(teamMembers.participantId, participantId));

      const teamIds = memberRows.map((r) => r.teamId);
      if (teamIds.length > 0) {
        await tx
          .update(teams)
          .set({
            status: 'ACTIVE',
            updatedAt: new Date(),
          })
          .where(inArray(teams.id, teamIds));
      }

      await tx.insert(auditLogs).values({
        adminUserId,
        action: 'PARTICIPANT_REACTIVATED',
        targetType: 'PARTICIPANT',
        targetId: participant.id,
        reason: reason?.trim() || 'Participant reactivated by administrator.',
        metadata: {
          participantId: participant.id,
          participantName: participant.name,
          participantCode: participant.participantCode,
          email: participant.email || null,
          college: participant.college || null,
          adminUserId,
          reason: reason?.trim() || null,
          timestamp: new Date().toISOString(),
        },
      });
    });

    try {
      teamRealtimeService.broadcastToAdmin('admin.participant.reactivated', {
        participantId,
        participantName: participant.name,
        timestamp: new Date().toISOString(),
      });
      teamRealtimeService.broadcastToAdmin('admin.metrics.updated', {
        reason: 'PARTICIPANT_REACTIVATED',
        participantId,
        timestamp: new Date().toISOString(),
      });
      leaderboardRealtimeService.notifyLeaderboardUpdated();
    } catch (err) {}

    return {
      success: true,
      statusCode: 200,
      message: `Participant "${participant.name}" has been reactivated.`,
      participant: {
        id: participant.id,
        name: participant.name,
        participantCode: participant.participantCode,
        email: participant.email,
        status: 'ACTIVE',
      },
    };
  }

  /**
   * Verifies start event preconditions.
   */
  async validateEventStartPreconditions(): Promise<{
    canStart: boolean;
    errors: string[];
    warnings: string[];
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Current event status
    const eventRow = await db.select().from(eventSettings).where(eq(eventSettings.id, 1)).limit(1);
    if (!eventRow[0]) {
      errors.push('Event configuration row missing in database.');
      return { canStart: false, errors, warnings };
    }

    if (eventRow[0].status !== 'NOT_STARTED') {
      errors.push(`Event cannot be started because current status is ${eventRow[0].status}.`);
    }

    // 2. Active participants check
    const participantCountRows = await db
      .select({ val: count() })
      .from(participants)
      .where(eq(participants.status, 'ACTIVE'));
    const participantCount = Number(participantCountRows[0]?.val || 0);

    if (participantCount === 0) {
      errors.push('EVENT CANNOT START: No competitors have been registered in the database.');
    }

    return {
      canStart: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Authoritative Event State Transitions with duplicate safety & transaction isolation.
   */
  async transitionEventStatus(
    targetStatus: 'RUNNING' | 'PAUSED' | 'ENDED',
    adminUserId: string,
    action: 'START' | 'PAUSE' | 'RESUME' | 'END'
  ): Promise<{ success: boolean; error?: string; event: any }> {
    const currentEvent = await db
      .select()
      .from(eventSettings)
      .where(eq(eventSettings.id, 1))
      .limit(1);
    if (!currentEvent[0]) {
      return { success: false, error: 'Event settings not initialized.', event: null };
    }

    const currentStatus = currentEvent[0].status;
    const now = new Date();

    // Validate state machine invariants:
    // NOT_STARTED -> RUNNING
    // RUNNING -> PAUSED
    // PAUSED -> RUNNING
    // RUNNING -> ENDED
    // PAUSED -> ENDED
    if (action === 'START') {
      if (currentStatus === 'RUNNING') {
        // Safe duplicate start
        return { success: true, event: currentEvent[0] };
      }
      if (currentStatus !== 'NOT_STARTED') {
        return {
          success: false,
          error: `Cannot start event. Current status is ${currentStatus}.`,
          event: currentEvent[0],
        };
      }
      const precheck = await this.validateEventStartPreconditions();
      if (!precheck.canStart) {
        return { success: false, error: precheck.errors.join(' '), event: currentEvent[0] };
      }
    } else if (action === 'PAUSE') {
      if (currentStatus === 'PAUSED') {
        // Safe duplicate pause
        return { success: true, event: currentEvent[0] };
      }
      if (currentStatus !== 'RUNNING') {
        return {
          success: false,
          error: `Cannot pause event. Current status is ${currentStatus}.`,
          event: currentEvent[0],
        };
      }
    } else if (action === 'RESUME') {
      if (currentStatus === 'RUNNING') {
        // Safe duplicate resume
        return { success: true, event: currentEvent[0] };
      }
      if (currentStatus !== 'PAUSED') {
        return {
          success: false,
          error: `Cannot resume event. Current status is ${currentStatus}.`,
          event: currentEvent[0],
        };
      }
    } else if (action === 'END') {
      if (currentStatus === 'ENDED') {
        // Safe duplicate end
        return { success: true, event: currentEvent[0] };
      }
      if (currentStatus === 'NOT_STARTED') {
        return {
          success: false,
          error: 'Cannot end an event that has not started.',
          event: currentEvent[0],
        };
      }
    }

    // Apply update
    const updateData: Record<string, any> = {
      status: targetStatus,
      updatedAt: now,
    };

    if (action === 'START') {
      updateData.startedAt = now;
      updateData.durationMinutes = 60;
      updateData.totalPausedDurationSeconds = 0;
      updateData.pausedAt = null;
      updateData.endedAt = null;
    } else if (action === 'PAUSE') {
      updateData.pausedAt = now;
    } else if (action === 'RESUME') {
      if (currentEvent[0].pausedAt) {
        const pauseDurationSecs = Math.floor(
          (now.getTime() - new Date(currentEvent[0].pausedAt).getTime()) / 1000
        );
        updateData.totalPausedDurationSeconds =
          (currentEvent[0].totalPausedDurationSeconds || 0) + Math.max(0, pauseDurationSecs);
      }
      updateData.pausedAt = null;
    } else if (action === 'END') {
      updateData.endedAt = now;
      updateData.pausedAt = null;
    }

    const updated = await db
      .update(eventSettings)
      .set(updateData)
      .where(eq(eventSettings.id, 1))
      .returning();

    const currentMatchNum = currentEvent[0].currentMatchNumber || 1;

    // Sync match state in competition_matches
    try {
      const matchRows = await db
        .select()
        .from(competitionMatches)
        .where(eq(competitionMatches.matchNumber, currentMatchNum))
        .limit(1);

      if (matchRows.length === 0) {
        await db.insert(competitionMatches).values({
          matchNumber: currentMatchNum,
          name: `Match ${currentMatchNum}`,
          status: targetStatus,
          durationMinutes: currentEvent[0].durationMinutes || 60,
          startedAt: action === 'START' ? now : null,
          endedAt: action === 'END' ? now : null,
          pausedAt: action === 'PAUSE' ? now : null,
        });
      } else {
        const matchUpdate: Record<string, any> = {
          status: targetStatus,
          updatedAt: now,
        };
        if (action === 'START') {
          matchUpdate.startedAt = now;
          matchUpdate.endedAt = null;
          matchUpdate.pausedAt = null;
          matchUpdate.totalPausedDurationSeconds = 0;
        } else if (action === 'PAUSE') {
          matchUpdate.pausedAt = now;
        } else if (action === 'RESUME') {
          matchUpdate.pausedAt = null;
          if (updateData.totalPausedDurationSeconds !== undefined) {
            matchUpdate.totalPausedDurationSeconds = updateData.totalPausedDurationSeconds;
          }
        } else if (action === 'END') {
          matchUpdate.endedAt = now;
          matchUpdate.pausedAt = null;
          // Capture authoritative final snapshot of leaderboard for this match
          const finalLeaderboard = await eventRepository.getLeaderboard();
          matchUpdate.finalLeaderboard = finalLeaderboard;
        }

        await db
          .update(competitionMatches)
          .set(matchUpdate)
          .where(eq(competitionMatches.id, matchRows[0].id));
      }

      // If END, archive current active team_challenges progress
      if (action === 'END') {
        const currentCompletions = await db.select().from(teamChallenges);
        for (const tc of currentCompletions) {
          await db.insert(matchHistoricalChallenges).values({
            matchNumber: currentMatchNum,
            teamId: tc.teamId,
            challengeId: tc.challengeId,
            status: tc.status,
            attemptCount: tc.attemptCount,
            unlockedAt: tc.unlockedAt,
            startedAt: tc.startedAt,
            completedAt: tc.completedAt,
            completionTimestamp: tc.completionTimestamp,
            completedBySessionId: tc.completedBySessionId,
          });
        }
      }
    } catch (syncErr) {
      console.warn('Warning during competition match state sync:', syncErr);
    }

    // Record audit log
    const auditAction =
      action === 'START'
        ? 'EVENT_STARTED'
        : action === 'PAUSE'
        ? 'EVENT_PAUSED'
        : action === 'RESUME'
        ? 'EVENT_RESUMED'
        : 'EVENT_ENDED';

    await this.recordAuditLog({
      adminUserId,
      action: auditAction,
      targetType: 'EVENT_SETTINGS',
      targetId: '1',
      reason: `Admin triggered ${action} action. Status: ${currentStatus} -> ${targetStatus}`,
      metadata: {
        previousStatus: currentStatus,
        newStatus: targetStatus,
        matchNumber: currentMatchNum,
      },
    });

    if (action === 'END') {
      await this.recordAuditLog({
        adminUserId,
        action: 'MATCH_ENDED',
        targetType: 'MATCH',
        targetId: String(currentMatchNum),
        reason: `Match ${currentMatchNum} reached terminal ENDED state. Final leaderboard preserved.`,
        metadata: {
          matchNumber: currentMatchNum,
          endedAt: now.toISOString(),
        },
      });
    }

    return { success: true, event: updated[0] };
  }

  /**
   * Creates and initializes a fresh competition run (Match 2, Match 3, etc.)
   * Explicitly triggered by administrator after current match has reached ENDED.
   * Preserves all historical submissions, completions, scores, and audit data.
   */
  async createNewMatch(
    adminUserId: string,
    options?: { matchName?: string; durationMinutes?: number }
  ): Promise<{ success: boolean; error?: string; match: any; event: any }> {
    if (AdminRepository.isCreatingMatchLock) {
      return {
        success: false,
        error: 'A new match creation is already in progress. Please wait.',
        match: null,
        event: null,
      };
    }

    AdminRepository.isCreatingMatchLock = true;
    try {
      const resolvedAdminId = await this.resolveAdminUserId(adminUserId);
      let finalLbSnapshot: any = null;
      try {
        finalLbSnapshot = await eventRepository.getLeaderboard();
      } catch (lbErr) {
        console.warn('Leaderboard pre-snapshot warning:', lbErr);
      }

      return await db.transaction(async (tx) => {
        const currentEvent = await tx
          .select()
          .from(eventSettings)
          .where(eq(eventSettings.id, 1))
          .limit(1);

        if (!currentEvent[0]) {
          return { success: false, error: 'Event settings not initialized.', match: null, event: null };
        }

        const currentStatus = currentEvent[0].status;
        if (currentStatus !== 'ENDED') {
          return {
            success: false,
            error: `Cannot create a new match while the current match status is "${currentStatus}". A new match can only be initialized after the previous match has concluded (status: ENDED).`,
            match: null,
            event: currentEvent[0],
          };
        }

        const currentMatchNumber = currentEvent[0].currentMatchNumber || 1;
        const nextMatchNumber = currentMatchNumber + 1;
        const matchName = options?.matchName?.trim() || `Match ${nextMatchNumber}`;
        const durationMinutes = options?.durationMinutes || 60;
        const now = new Date();

        // 1. If current match was ended, ensure its history and leaderboard snapshot are captured
        try {
          const activeMatch = await tx
            .select()
            .from(competitionMatches)
            .where(eq(competitionMatches.matchNumber, currentMatchNumber))
            .limit(1);

          if (activeMatch.length > 0 && (!activeMatch[0].finalLeaderboard || activeMatch[0].status !== 'ENDED')) {
            await tx
              .update(competitionMatches)
              .set({
                status: 'ENDED',
                endedAt: activeMatch[0].endedAt || now,
                finalLeaderboard: finalLbSnapshot,
                updatedAt: now,
              })
              .where(eq(competitionMatches.id, activeMatch[0].id));
          }

          // Archive any unarchived completions from current active team_challenges
          const currentCompletions = await tx.select().from(teamChallenges);
          for (const tc of currentCompletions) {
            await tx.insert(matchHistoricalChallenges).values({
              matchId: activeMatch[0]?.id || null,
              matchNumber: currentMatchNumber,
              teamId: tc.teamId,
              challengeId: tc.challengeId,
              status: tc.status,
              attemptCount: tc.attemptCount,
              unlockedAt: tc.unlockedAt,
              startedAt: tc.startedAt,
              completedAt: tc.completedAt,
              completionTimestamp: tc.completionTimestamp,
              completedBySessionId: tc.completedBySessionId,
            });
          }
        } catch (archiveErr) {
          console.warn('Archiving warning during match transition:', archiveErr);
        }

        // 2. Create the new match record in competition_matches
        const [newMatch] = await tx
          .insert(competitionMatches)
          .values({
            matchNumber: nextMatchNumber,
            name: matchName,
            status: 'NOT_STARTED',
            durationMinutes,
            createdByAdminId: resolvedAdminId,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        // 3. Reset active competition progress for the fresh match
        // Clear active participant and team challenges so solves/attempts start at 0
        await tx.delete(participantChallenges);
        await tx.delete(participantUnlockedRounds);
        await tx.delete(teamChallenges);
        await tx.delete(teamUnlockedRounds);

        // Clear temporary administrative progression overrides
        await tx.delete(progressionOverrides);

        // 4. Reset event settings to NOT_STARTED for the new match
        const [updatedEvent] = await tx
          .update(eventSettings)
          .set({
            status: 'NOT_STARTED',
            durationMinutes,
            startedAt: null,
            endedAt: null,
            pausedAt: null,
            totalPausedDurationSeconds: 0,
            currentMatchNumber: nextMatchNumber,
            currentMatchId: newMatch.id,
            updatedAt: now,
          })
          .where(eq(eventSettings.id, 1))
          .returning();

        // 5. Record Authoritative Audit Trail
        await this.recordAuditLog(
          {
            adminUserId,
            action: 'NEW_MATCH_CREATED',
            targetType: 'MATCH',
            targetId: String(nextMatchNumber),
            reason: `Admin created ${matchName} (Match #${nextMatchNumber}). Clean arena state initialized.`,
            metadata: {
              previousMatchNumber: currentMatchNumber,
              newMatchNumber: nextMatchNumber,
              matchId: newMatch.id,
              durationMinutes,
              createdAt: now.toISOString(),
            },
          },
          tx
        );

        // 6. Broadcast Realtime Notifications across Arena & Live Scoreboard
        try {
          teamRealtimeService.broadcastGlobal('event.status.changed', {
            status: 'NOT_STARTED',
            matchNumber: nextMatchNumber,
            matchName,
            message: `${matchName} initialized in NOT_STARTED state. Waiting room active.`,
            timestamp: now.toISOString(),
          });
          teamRealtimeService.broadcastGlobal('match.reset', {
            matchNumber: nextMatchNumber,
            matchName,
          });
          leaderboardRealtimeService.broadcastEventStatusChanged({
            status: 'NOT_STARTED',
            remainingSeconds: durationMinutes * 60,
            elapsedSeconds: 0,
            durationMinutes,
            message: `${matchName} initialized in NOT_STARTED state.`,
            timestamp: now.toISOString(),
          });
          leaderboardRealtimeService.notifyLeaderboardUpdated();
        } catch (broadcastErr) {
          console.warn('Realtime broadcast notification warning:', broadcastErr);
        }

        return {
          success: true,
          match: newMatch,
          event: updatedEvent,
        };
      });
    } finally {
      AdminRepository.isCreatingMatchLock = false;
    }
  }

  /**
   * Retrieves all competition matches and their historical states.
   */
  async getMatches(): Promise<any[]> {
    const list = await db
      .select({
        id: competitionMatches.id,
        matchNumber: competitionMatches.matchNumber,
        name: competitionMatches.name,
        status: competitionMatches.status,
        durationMinutes: competitionMatches.durationMinutes,
        startedAt: competitionMatches.startedAt,
        endedAt: competitionMatches.endedAt,
        pausedAt: competitionMatches.pausedAt,
        totalPausedDurationSeconds: competitionMatches.totalPausedDurationSeconds,
        finalLeaderboard: competitionMatches.finalLeaderboard,
        summary: competitionMatches.summary,
        endedReason: competitionMatches.endedReason,
        createdAt: competitionMatches.createdAt,
        createdByAdminId: competitionMatches.createdByAdminId,
      })
      .from(competitionMatches)
      .orderBy(desc(competitionMatches.matchNumber));

    return list;
  }

  /**
   * Retrieves leaderboard for a specific match (either active live or archived).
   */
  async getMatchLeaderboard(matchNumber: number): Promise<{
    matchNumber: number;
    name: string;
    status: string;
    isArchived: boolean;
    leaderboard: any[];
  } | null> {
    const [match] = await db
      .select()
      .from(competitionMatches)
      .where(eq(competitionMatches.matchNumber, matchNumber))
      .limit(1);

    if (!match) {
      return null;
    }

    const currentEvent = await db
      .select()
      .from(eventSettings)
      .where(eq(eventSettings.id, 1))
      .limit(1);

    const isCurrent = currentEvent[0]?.currentMatchNumber === matchNumber;

    if (isCurrent && match.status !== 'ENDED') {
      const liveLeaderboard = await eventRepository.getLeaderboard();
      return {
        matchNumber: match.matchNumber,
        name: match.name,
        status: match.status,
        isArchived: false,
        leaderboard: liveLeaderboard,
      };
    }

    // Return archived final leaderboard if available
    if (match.finalLeaderboard && Array.isArray(match.finalLeaderboard)) {
      return {
        matchNumber: match.matchNumber,
        name: match.name,
        status: match.status,
        isArchived: true,
        leaderboard: match.finalLeaderboard,
      };
    }

    // Fallback if not snapshotted yet
    const lb = await eventRepository.getLeaderboard();
    return {
      matchNumber: match.matchNumber,
      name: match.name,
      status: match.status,
      isArchived: match.status === 'ENDED',
      leaderboard: lb,
    };
  }
}

export const adminRepository = new AdminRepository();

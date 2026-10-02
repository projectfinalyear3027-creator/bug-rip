/**
 * BUG SNIPER - Authoritative Participant Presence Service
 *
 * Core Guarantees:
 * 1. Server-authoritative presence tracking.
 * 2. Authenticated participant session required.
 * 3. Match-scoped: presence is strictly isolated per match ID / matchNumber.
 * 4. ONLINE when lastSeenAt >= current server time - 30 seconds.
 * 5. OFFLINE when:
 *    - Participant logs out
 *    - Participant session expires
 *    - Heartbeat stops for > 30 seconds
 *    - Match changes (no leak to new match)
 *    - Match ends (participants no longer actively ONLINE for ended competition)
 * 6. Lightweight real-time SSE broadcasts on state transitions.
 * 7. Score calculations & canonical rankings remain 100% unchanged.
 */

import { leaderboardRealtimeService } from './leaderboardRealtimeService.ts';

export interface ParticipantPresenceRecord {
  participantId: string;
  sessionId: string;
  matchNumber: number;
  matchId: string | null;
  lastSeenAt: Date;
  wasOnline: boolean;
}

export interface PresenceSnapshot {
  matchNumber: number;
  onlineCount: number;
  totalCount: number;
  onlineParticipantIds: string[];
  presenceMap: Record<string, boolean>;
}

export class PresenceService {
  // Map<matchNumber, Map<participantId, ParticipantPresenceRecord>>
  private presenceByMatch: Map<number, Map<string, ParticipantPresenceRecord>> = new Map();
  // Map<sessionId, { matchNumber: number; participantId: string }>
  private sessionIndex: Map<string, { matchNumber: number; participantId: string }> = new Map();
  // Set of match numbers that have ended
  private endedMatches: Set<number> = new Set();
  // Periodic pruner timer
  private pruneTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.startPruner();
  }

  private startPruner() {
    if (this.pruneTimer) return;
    this.pruneTimer = setInterval(() => {
      this.checkHeartbeatExpirations();
    }, 5000);

    if (this.pruneTimer.unref) {
      this.pruneTimer.unref();
    }
  }

  /**
   * Records an authenticated participant heartbeat pulse.
   */
  public recordHeartbeat(params: {
    participantId: string;
    sessionId: string;
    matchNumber: number;
    matchId?: string | null;
    isEnded?: boolean;
    timestamp?: Date;
  }): { isOnline: boolean; lastSeenAt: Date } {
    const { participantId, sessionId, matchNumber, matchId = null, isEnded = false } = params;
    const now = params.timestamp || new Date();

    if (isEnded || this.endedMatches.has(matchNumber)) {
      // Competitions that have concluded cannot have active online presence
      return { isOnline: false, lastSeenAt: now };
    }

    if (!this.presenceByMatch.has(matchNumber)) {
      this.presenceByMatch.set(matchNumber, new Map());
    }
    const matchMap = this.presenceByMatch.get(matchNumber)!;

    const existing = matchMap.get(participantId);
    const wasOnline = existing
      ? (now.getTime() - existing.lastSeenAt.getTime()) <= 30000
      : false;

    const record: ParticipantPresenceRecord = {
      participantId,
      sessionId,
      matchNumber,
      matchId,
      lastSeenAt: now,
      wasOnline: true,
    };

    matchMap.set(participantId, record);
    this.sessionIndex.set(sessionId, { matchNumber, participantId });

    // If transitioned from OFFLINE -> ONLINE, notify live scoreboard spectators
    if (!wasOnline) {
      this.broadcastPresence(matchNumber);
    }

    return { isOnline: true, lastSeenAt: now };
  }

  /**
   * Checks if a participant is currently ONLINE for a specific match.
   */
  public isParticipantOnline(
    participantId: string,
    matchNumber: number,
    now: Date = new Date()
  ): boolean {
    if (this.endedMatches.has(matchNumber)) {
      return false;
    }

    const matchMap = this.presenceByMatch.get(matchNumber);
    if (!matchMap) return false;

    const record = matchMap.get(participantId);
    if (!record) return false;

    const elapsedMs = now.getTime() - record.lastSeenAt.getTime();
    return elapsedMs <= 30000;
  }

  /**
   * Retrieves lastSeenAt timestamp for a participant in a match.
   */
  public getLastSeenAt(participantId: string, matchNumber: number): Date | null {
    const matchMap = this.presenceByMatch.get(matchNumber);
    if (!matchMap) return null;
    const record = matchMap.get(participantId);
    return record ? record.lastSeenAt : null;
  }

  /**
   * Called when participant explicitly logs out.
   */
  public recordLogout(participantId: string, sessionId?: string) {
    let changedMatchNumber: number | null = null;

    for (const [matchNum, matchMap] of this.presenceByMatch.entries()) {
      const record = matchMap.get(participantId);
      if (record) {
        const wasOnline = record.wasOnline && (Date.now() - record.lastSeenAt.getTime()) <= 30000;
        record.lastSeenAt = new Date(0);
        record.wasOnline = false;
        if (wasOnline) {
          changedMatchNumber = matchNum;
        }
      }
    }

    if (sessionId) {
      this.sessionIndex.delete(sessionId);
    }

    if (changedMatchNumber !== null) {
      this.broadcastPresence(changedMatchNumber);
    }
  }

  /**
   * Called when participant session expires due to inactivity.
   */
  public expireSession(sessionId: string) {
    const indexed = this.sessionIndex.get(sessionId);
    if (!indexed) return;

    this.sessionIndex.delete(sessionId);
    const { matchNumber, participantId } = indexed;

    const matchMap = this.presenceByMatch.get(matchNumber);
    if (matchMap) {
      const record = matchMap.get(participantId);
      if (record && record.sessionId === sessionId) {
        const wasOnline = record.wasOnline && (Date.now() - record.lastSeenAt.getTime()) <= 30000;
        record.lastSeenAt = new Date(0);
        record.wasOnline = false;
        if (wasOnline) {
          this.broadcastPresence(matchNumber);
        }
      }
    }
  }

  /**
   * Handles competition conclusion: marks all participants offline for that match.
   */
  public onMatchEnded(matchNumber: number) {
    this.endedMatches.add(matchNumber);
    const matchMap = this.presenceByMatch.get(matchNumber);
    if (matchMap) {
      for (const record of matchMap.values()) {
        record.wasOnline = false;
      }
    }
    this.broadcastPresence(matchNumber);
  }

  /**
   * Handles new match creation: resets presence state so old presence does not leak.
   */
  public onMatchChange(newMatchNumber: number) {
    // Clear ended status for new match
    this.endedMatches.delete(newMatchNumber);
    // Initialize fresh empty presence map for the new match
    this.presenceByMatch.set(newMatchNumber, new Map());
    this.broadcastPresence(newMatchNumber);
  }

  /**
   * Periodic check: detects participants whose heartbeat stopped for > 30 seconds.
   */
  private checkHeartbeatExpirations() {
    const now = new Date();

    for (const [matchNum, matchMap] of this.presenceByMatch.entries()) {
      if (this.endedMatches.has(matchNum)) continue;

      let hasTransition = false;
      for (const record of matchMap.values()) {
        if (record.wasOnline) {
          const elapsedMs = now.getTime() - record.lastSeenAt.getTime();
          if (elapsedMs > 30000) {
            record.wasOnline = false;
            hasTransition = true;
          }
        }
      }

      if (hasTransition) {
        this.broadcastPresence(matchNum);
      }
    }
  }

  /**
   * Returns current snapshot of presence for a match.
   */
  public getPresenceSnapshot(matchNumber: number, now: Date = new Date()): PresenceSnapshot {
    const matchMap = this.presenceByMatch.get(matchNumber);
    const presenceMap: Record<string, boolean> = {};
    const onlineParticipantIds: string[] = [];

    if (matchMap && !this.endedMatches.has(matchNumber)) {
      for (const [pId, record] of matchMap.entries()) {
        const isOnline = (now.getTime() - record.lastSeenAt.getTime()) <= 30000;
        presenceMap[pId] = isOnline;
        if (isOnline) {
          onlineParticipantIds.push(pId);
        }
      }
    }

    return {
      matchNumber,
      onlineCount: onlineParticipantIds.length,
      totalCount: matchMap ? matchMap.size : 0,
      onlineParticipantIds,
      presenceMap,
    };
  }

  /**
   * Lightweight broadcast of presence updates via Server-Sent Events.
   */
  public broadcastPresence(matchNumber: number) {
    try {
      const snapshot = this.getPresenceSnapshot(matchNumber);
      leaderboardRealtimeService.broadcast('presence.updated', {
        matchNumber,
        onlineCount: snapshot.onlineCount,
        totalParticipants: snapshot.totalCount,
        presenceMap: snapshot.presenceMap,
        onlineParticipantIds: snapshot.onlineParticipantIds,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('[PresenceService] Error broadcasting presence update:', err);
    }
  }

  /**
   * Live Scoreboard Presentation Ordering:
   * 1. ONLINE participants first
   * 2. Existing leaderboard ordering within each group:
   *    - Problems Solved DESC
   *    - Score DESC
   *    - earliest achievement/last solve timestamp ASC
   *    - Participant Name ASC
   *
   * Note: The actual competition ranking (`rank`) and score calculation are NOT modified.
   */
  public applyLiveScoreboardOrdering<T extends {
    rank: number;
    participantId?: string;
    teamId?: string;
    participantName?: string;
    teamName: string;
    isOnline?: boolean;
    problemsSolved: number;
    score: number;
    lastSolveTimestamp: string;
  }>(entries: T[], matchNumber: number, isArchivedMatch = false, now: Date = new Date()): (T & { isOnline: boolean })[] {
    if (isArchivedMatch) {
      // Historical match leaderboards remain exactly as they are without presence modification
      return entries.map((e) => ({ ...e, isOnline: Boolean(e.isOnline) }));
    }

    const annotated = entries.map((entry) => {
      const pId = entry.participantId || entry.teamId || entry.teamName;
      const isOnline = entry.isOnline !== undefined
        ? Boolean(entry.isOnline)
        : this.isParticipantOnline(pId, matchNumber, now);

      return {
        ...entry,
        isOnline,
      };
    });

    return annotated.sort((a, b) => {
      // 1. ONLINE participants first
      const aOnline = Boolean(a.isOnline);
      const bOnline = Boolean(b.isOnline);
      if (aOnline !== bOnline) {
        return aOnline ? -1 : 1;
      }

      // 2. Existing leaderboard ordering: Problems Solved DESC
      if (a.problemsSolved !== b.problemsSolved) {
        return b.problemsSolved - a.problemsSolved;
      }

      // 3. Score DESC
      if (a.score !== b.score) {
        return b.score - a.score;
      }

      // 4. Earliest achievement timestamp ASC
      const timeA = new Date(a.lastSolveTimestamp).getTime();
      const timeB = new Date(b.lastSolveTimestamp).getTime();
      if (timeA !== timeB) {
        return timeA - timeB;
      }

      // 5. Participant Name ASC
      const nameA = a.participantName || a.teamName || '';
      const nameB = b.participantName || b.teamName || '';
      return nameA.localeCompare(nameB);
    });
  }

  /**
   * Reset helper for testing environments.
   */
  public resetForTesting() {
    this.presenceByMatch.clear();
    this.sessionIndex.clear();
    this.endedMatches.clear();
  }
}

export const presenceService = new PresenceService();

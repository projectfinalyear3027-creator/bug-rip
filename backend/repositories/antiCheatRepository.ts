/**
 * BUG RIP - Anti-Cheat & Integrity Repository
 * Provides authoritative persistence and querying for participant browser signals,
 * tab visibility, window blur/focus, fullscreen transitions, and session violations.
 * 
 * Invariants:
 * 1. Team identity is always verified server-side; clients cannot record events for other teams.
 * 2. Unreliable browser signals do NOT automatically disqualify teams.
 * 3. Events are immutable evidence preserved for organizer review and audit.
 */

import { db } from '../../src/db/index.ts';
import { antiCheatEvents, teams, sessions, adminUsers, challenges, participants, eventSettings } from '../../src/db/schema.ts';
import { eq, desc, and, or, sql, inArray } from 'drizzle-orm';
import { teamRealtimeService } from '../services/teamRealtimeService.ts';

export type AntiCheatEventType =
  | 'TAB_HIDDEN'
  | 'TAB_VISIBLE'
  | 'WINDOW_BLUR'
  | 'WINDOW_FOCUS'
  | 'FULLSCREEN_EXIT'
  | 'FULLSCREEN_ENTER'
  | 'VIEWPORT_CHANGE'
  | 'VIEWPORT_RESIZE'
  | 'BROWSER_UNSUPPORTED'
  | 'PAGE_RELOAD'
  | 'RELOAD'
  | 'RECONNECT'
  | 'MULTIPLE_SESSION'
  | 'MULTI_SESSION_ATTEMPT'
  | 'SESSION_REJECTED'
  | 'HEARTBEAT_TIMEOUT'
  | 'COPY_PASTE_FLAG';

export type AntiCheatAction =
  | 'LOGGED'
  | 'WARNING'
  | 'RECORDED_VIOLATION'
  | 'TEMPORARY_LOCK'
  | 'ADMIN_REVIEW'
  | 'VERIFIED_CLEAR'
  | 'FLAGGED_VIOLATION'
  | 'DISQUALIFICATION';

export interface RecordAntiCheatEventParams {
  participantId?: string | null;
  teamId?: string | null;
  participantSessionId?: string | null;
  challengeId?: string | null;
  eventType: AntiCheatEventType;
  actionTaken?: AntiCheatAction;
  metadata?: Record<string, any>;
  matchNumber?: number;
  matchId?: string | null;
}

export interface AntiCheatEventRecord {
  id: string;
  teamId?: string | null;
  participantId?: string | null;
  teamName?: string;
  teamCode?: string;
  participantName?: string | null;
  participantCode?: string | null;
  participantSessionId?: string | null;
  challengeId?: string | null;
  challengeTitle?: string | null;
  eventType: AntiCheatEventType;
  actionTaken: AntiCheatAction;
  metadata: Record<string, any> | null;
  reviewedBy?: string | null;
  reviewedByAdminUsername?: string | null;
  adminNotes?: string | null;
  reviewedAt?: Date | null;
  matchNumber?: number;
  matchId?: string | null;
  createdAt: Date;
}

export class AntiCheatRepository {
  /**
   * Record a new anti-cheat event with server-derived team and session identity.
   * Resilient to both team-based and solo individual participant competition models.
   */
  async recordEvent(params: RecordAntiCheatEventParams): Promise<AntiCheatEventRecord> {
    const actionTaken: AntiCheatAction =
      params.actionTaken ||
      (params.eventType === 'FULLSCREEN_EXIT' ||
      params.eventType === 'TAB_HIDDEN' ||
      params.eventType === 'WINDOW_BLUR' ||
      params.eventType === 'MULTIPLE_SESSION' ||
      params.eventType === 'MULTI_SESSION_ATTEMPT'
        ? 'RECORDED_VIOLATION'
        : 'WARNING');

    let resolvedTeamId: string | null = params.teamId || null;
    let resolvedParticipantId: string | null = params.participantId || null;

    // 1. If participantSessionId is provided, enrich missing IDs from the session record
    if (params.participantSessionId && (!resolvedTeamId || !resolvedParticipantId)) {
      try {
        const [sess] = await db
          .select({
            teamId: sessions.teamId,
            participantId: sessions.participantId,
          })
          .from(sessions)
          .where(eq(sessions.id, params.participantSessionId))
          .limit(1);

        if (sess) {
          if (!resolvedParticipantId && sess.participantId) {
            resolvedParticipantId = sess.participantId;
          }
          if (!resolvedTeamId && sess.teamId) {
            resolvedTeamId = sess.teamId;
          }
        }
      } catch (err) {
        console.warn('Session lookup error during anti-cheat recording:', err);
      }
    }

    // 2. Validate resolvedTeamId against the teams table to prevent Foreign Key Violations
    if (resolvedTeamId) {
      try {
        const [validTeam] = await db
          .select({ id: teams.id })
          .from(teams)
          .where(eq(teams.id, resolvedTeamId))
          .limit(1);

        if (!validTeam) {
          // If resolvedTeamId is not in teams, it might be a participantId from authMiddleware
          if (!resolvedParticipantId) {
            const [validPart] = await db
              .select({ id: participants.id })
              .from(participants)
              .where(eq(participants.id, resolvedTeamId))
              .limit(1);

            if (validPart) {
              resolvedParticipantId = validPart.id;
            }
          }
          // Do not attempt to insert an invalid teamId into anti_cheat_events
          resolvedTeamId = null;
        }
      } catch (err) {
        console.warn('Team validation error during anti-cheat recording:', err);
        resolvedTeamId = null;
      }
    }

    // 3. Validate resolvedParticipantId against participants table
    if (resolvedParticipantId) {
      try {
        const [validPart] = await db
          .select({ id: participants.id })
          .from(participants)
          .where(eq(participants.id, resolvedParticipantId))
          .limit(1);

        if (!validPart) {
          resolvedParticipantId = null;
        }
      } catch (err) {
        console.warn('Participant validation error during anti-cheat recording:', err);
        resolvedParticipantId = null;
      }
    }

    // 4. Validate participantSessionId against sessions table
    let resolvedSessionId: string | null = params.participantSessionId || null;
    if (resolvedSessionId) {
      try {
        const [validSess] = await db
          .select({ id: sessions.id })
          .from(sessions)
          .where(eq(sessions.id, resolvedSessionId))
          .limit(1);

        if (!validSess) {
          resolvedSessionId = null;
        }
      } catch {
        resolvedSessionId = null;
      }
    }

    let matchNumber = params.matchNumber;
    let matchId = params.matchId || null;

    if (!matchNumber) {
      try {
        const [settings] = await db
          .select({
            currentMatchNumber: eventSettings.currentMatchNumber,
            currentMatchId: eventSettings.currentMatchId,
          })
          .from(eventSettings)
          .where(eq(eventSettings.id, 1))
          .limit(1);
        if (settings) {
          matchNumber = settings.currentMatchNumber || 1;
          matchId = settings.currentMatchId || null;
        }
      } catch {
        matchNumber = 1;
      }
    }

    const [inserted] = await db
      .insert(antiCheatEvents)
      .values({
        teamId: resolvedTeamId,
        participantId: resolvedParticipantId,
        participantSessionId: resolvedSessionId,
        challengeId: params.challengeId || null,
        eventType: params.eventType as any,
        actionTaken: actionTaken as any,
        metadata: params.metadata || {},
        matchNumber: matchNumber || 1,
        matchId: matchId || null,
      })
      .returning();

    // Broadcast real-time anti-cheat event to organizers
    try {
      teamRealtimeService.broadcastToAdmin('admin.anticheat.event', {
        event: {
          id: inserted.id,
          teamId: inserted.teamId,
          participantId: inserted.participantId,
          eventType: inserted.eventType,
          actionTaken: inserted.actionTaken,
          matchNumber: inserted.matchNumber,
          createdAt: inserted.createdAt,
        },
      });
    } catch {
      // safe fallback
    }

    return {
      id: inserted.id,
      teamId: inserted.teamId,
      participantId: inserted.participantId,
      participantSessionId: inserted.participantSessionId,
      challengeId: inserted.challengeId,
      eventType: inserted.eventType as AntiCheatEventType,
      actionTaken: inserted.actionTaken as AntiCheatAction,
      metadata: (inserted.metadata as Record<string, any>) || null,
      reviewedBy: inserted.reviewedBy,
      adminNotes: inserted.adminNotes,
      reviewedAt: inserted.reviewedAt,
      matchNumber: inserted.matchNumber,
      matchId: inserted.matchId,
      createdAt: inserted.createdAt,
    };
  }

  /**
   * Fetch paginated anti-cheat events joined with team details and challenge info.
   */
  async getEvents(options: {
    teamId?: string;
    participantId?: string;
    eventType?: string;
    actionTaken?: string;
    matchNumber?: number;
    limit?: number;
    offset?: number;
  } = {}): Promise<AntiCheatEventRecord[]> {
    const limit = Math.min(Math.max(options.limit || 50, 1), 500);
    const offset = Math.max(options.offset || 0, 0);

    const conditions = [];
    if (options.teamId) {
      conditions.push(or(eq(antiCheatEvents.teamId, options.teamId), eq(antiCheatEvents.participantId, options.teamId)));
    }
    if (options.participantId) {
      conditions.push(eq(antiCheatEvents.participantId, options.participantId));
    }
    if (options.eventType) {
      conditions.push(eq(antiCheatEvents.eventType, options.eventType as any));
    }
    if (options.actionTaken) {
      conditions.push(eq(antiCheatEvents.actionTaken, options.actionTaken as any));
    }
    if (options.matchNumber !== undefined) {
      conditions.push(eq(antiCheatEvents.matchNumber, options.matchNumber));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db
      .select({
        id: antiCheatEvents.id,
        teamId: antiCheatEvents.teamId,
        participantId: antiCheatEvents.participantId,
        teamName: teams.teamName,
        teamCode: teams.teamCode,
        participantName: participants.name,
        participantCode: participants.participantCode,
        participantSessionId: antiCheatEvents.participantSessionId,
        challengeId: antiCheatEvents.challengeId,
        challengeTitle: challenges.title,
        eventType: antiCheatEvents.eventType,
        actionTaken: antiCheatEvents.actionTaken,
        metadata: antiCheatEvents.metadata,
        reviewedBy: antiCheatEvents.reviewedBy,
        reviewedByAdminUsername: adminUsers.username,
        adminNotes: antiCheatEvents.adminNotes,
        reviewedAt: antiCheatEvents.reviewedAt,
        matchNumber: antiCheatEvents.matchNumber,
        matchId: antiCheatEvents.matchId,
        createdAt: antiCheatEvents.createdAt,
      })
      .from(antiCheatEvents)
      .leftJoin(teams, eq(antiCheatEvents.teamId, teams.id))
      .leftJoin(participants, eq(antiCheatEvents.participantId, participants.id))
      .leftJoin(challenges, eq(antiCheatEvents.challengeId, challenges.id))
      .leftJoin(adminUsers, eq(antiCheatEvents.reviewedBy, adminUsers.id))
      .where(whereClause)
      .orderBy(desc(antiCheatEvents.createdAt))
      .limit(limit)
      .offset(offset);

    return rows.map((r: any) => ({
      id: r.id,
      teamId: r.teamId || r.participantId,
      participantId: r.participantId,
      teamName: r.teamName || r.participantName || 'Solo Competitor',
      teamCode: r.teamCode || r.participantCode || 'SOLO',
      participantName: r.participantName || null,
      participantCode: r.participantCode || null,
      participantSessionId: r.participantSessionId,
      challengeId: r.challengeId,
      challengeTitle: r.challengeTitle || null,
      eventType: r.eventType as AntiCheatEventType,
      actionTaken: r.actionTaken as AntiCheatAction,
      metadata: r.metadata || null,
      reviewedBy: r.reviewedBy,
      reviewedByAdminUsername: r.reviewedByAdminUsername || null,
      adminNotes: r.adminNotes,
      reviewedAt: r.reviewedAt,
      matchNumber: r.matchNumber,
      matchId: r.matchId,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Count total events matching filter.
   */
  async getEventsCount(options: {
    teamId?: string;
    participantId?: string;
    eventType?: string;
    actionTaken?: string;
    matchNumber?: number;
  } = {}): Promise<number> {
    const conditions = [];
    if (options.teamId) {
      conditions.push(or(eq(antiCheatEvents.teamId, options.teamId), eq(antiCheatEvents.participantId, options.teamId)));
    }
    if (options.participantId) {
      conditions.push(eq(antiCheatEvents.participantId, options.participantId));
    }
    if (options.eventType) {
      conditions.push(eq(antiCheatEvents.eventType, options.eventType as any));
    }
    if (options.actionTaken) {
      conditions.push(eq(antiCheatEvents.actionTaken, options.actionTaken as any));
    }
    if (options.matchNumber !== undefined) {
      conditions.push(eq(antiCheatEvents.matchNumber, options.matchNumber));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(antiCheatEvents)
      .where(whereClause);

    return result?.count || 0;
  }

  /**
   * Get high-level summary metrics across the competition.
   */
  async getSummaryStats(options?: { matchNumber?: number }): Promise<{
    totalEvents: number;
    fullscreenExits: number;
    tabHiddenEvents: number;
    windowBlurEvents: number;
    viewportChanges: number;
    multiSessionAttempts: number;
    teamsWithEvents: number;
    breakdownByType: Record<string, number>;
    recentIncidentsCount: number;
  }> {
    const conditions = [];
    if (options?.matchNumber !== undefined) {
      conditions.push(eq(antiCheatEvents.matchNumber, options.matchNumber));
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const allEvents = await db
      .select({
        eventType: antiCheatEvents.eventType,
        teamId: antiCheatEvents.teamId,
        participantId: antiCheatEvents.participantId,
        createdAt: antiCheatEvents.createdAt,
      })
      .from(antiCheatEvents)
      .where(whereClause);

    const breakdownByType: Record<string, number> = {};
    const teamsSet = new Set<string>();
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    let recentCount = 0;

    for (const ev of allEvents) {
      const type = ev.eventType;
      breakdownByType[type] = (breakdownByType[type] || 0) + 1;
      const entityId = ev.teamId || ev.participantId;
      if (entityId) {
        teamsSet.add(entityId);
      }
      if (new Date(ev.createdAt) >= tenMinutesAgo) {
        recentCount++;
      }
    }

    return {
      totalEvents: allEvents.length,
      fullscreenExits: breakdownByType['FULLSCREEN_EXIT'] || 0,
      tabHiddenEvents: breakdownByType['TAB_HIDDEN'] || 0,
      windowBlurEvents: breakdownByType['WINDOW_BLUR'] || 0,
      viewportChanges: (breakdownByType['VIEWPORT_CHANGE'] || 0) + (breakdownByType['VIEWPORT_RESIZE'] || 0),
      multiSessionAttempts: (breakdownByType['MULTIPLE_SESSION'] || 0) + (breakdownByType['MULTI_SESSION_ATTEMPT'] || 0),
      teamsWithEvents: teamsSet.size,
      breakdownByType,
      recentIncidentsCount: recentCount,
    };
  }

  /**
   * Get team-specific summary and incident list.
   */
  async getTeamSummary(teamId: string): Promise<{
    teamId: string;
    totalEvents: number;
    violationsCount: number;
    breakdownByType: Record<string, number>;
    latestEvent: AntiCheatEventRecord | null;
    recentEvents: AntiCheatEventRecord[];
  }> {
    const recentEvents = await this.getEvents({ teamId, limit: 100 });
    const breakdownByType: Record<string, number> = {};
    let violationsCount = 0;

    for (const ev of recentEvents) {
      breakdownByType[ev.eventType] = (breakdownByType[ev.eventType] || 0) + 1;
      if (ev.actionTaken === 'RECORDED_VIOLATION' || ev.actionTaken === 'DISQUALIFICATION' || ev.actionTaken === 'TEMPORARY_LOCK') {
        violationsCount++;
      }
    }

    return {
      teamId,
      totalEvents: recentEvents.length,
      violationsCount,
      breakdownByType,
      latestEvent: recentEvents.length > 0 ? recentEvents[0] : null,
      recentEvents,
    };
  }

  /**
   * Review an anti-cheat event (admin action).
   */
  async reviewEvent(
    eventId: string,
    adminUserId: string,
    options: {
      actionTaken?: AntiCheatAction;
      adminNotes?: string;
    } = {}
  ): Promise<AntiCheatEventRecord | null> {
    const updates: Record<string, any> = {
      reviewedBy: adminUserId,
      reviewedAt: new Date(),
    };

    if (options.actionTaken) {
      updates.actionTaken = options.actionTaken;
    }
    if (options.adminNotes !== undefined) {
      updates.adminNotes = options.adminNotes;
    }

    const [updated] = await db
      .update(antiCheatEvents)
      .set(updates)
      .where(eq(antiCheatEvents.id, eventId))
      .returning();

    if (!updated) return null;

    const [full] = await this.getEvents({ limit: 1 });
    return {
      id: updated.id,
      teamId: updated.teamId,
      participantSessionId: updated.participantSessionId,
      challengeId: updated.challengeId,
      eventType: updated.eventType as AntiCheatEventType,
      actionTaken: updated.actionTaken as AntiCheatAction,
      metadata: (updated.metadata as Record<string, any>) || null,
      reviewedBy: updated.reviewedBy,
      adminNotes: updated.adminNotes,
      reviewedAt: updated.reviewedAt,
      createdAt: updated.createdAt,
    };
  }

  /**
   * Get teams ranked by violation count.
   */
  async getTeamsByViolations(): Promise<
    Array<{
      teamId: string;
      teamName: string;
      teamCode: string;
      accessCode: string;
      totalEvents: number;
      eventsByType: Record<string, number>;
      fullscreenExits: number;
      tabHiddenCount: number;
      blurCount: number;
      lastEventAt: Date | null;
      latestEventAt: string | null;
    }>
  > {
    const events = await db
      .select({
        teamId: antiCheatEvents.teamId,
        participantId: antiCheatEvents.participantId,
        teamName: teams.teamName,
        teamCode: teams.teamCode,
        participantName: participants.name,
        participantCode: participants.participantCode,
        eventType: antiCheatEvents.eventType,
        createdAt: antiCheatEvents.createdAt,
      })
      .from(antiCheatEvents)
      .leftJoin(teams, eq(antiCheatEvents.teamId, teams.id))
      .leftJoin(participants, eq(antiCheatEvents.participantId, participants.id));

    const map = new Map<
      string,
      {
        teamId: string;
        teamName: string;
        teamCode: string;
        accessCode: string;
        totalEvents: number;
        eventsByType: Record<string, number>;
        fullscreenExits: number;
        tabHiddenCount: number;
        blurCount: number;
        lastEventAt: Date | null;
        latestEventAt: string | null;
      }
    >();

    for (const ev of events) {
      const entityId = ev.teamId || ev.participantId;
      if (!entityId) continue;

      let item = map.get(entityId);
      if (!item) {
        const resolvedName = ev.teamName || ev.participantName || 'Solo Competitor';
        const resolvedCode = ev.teamCode || ev.participantCode || 'SOLO';
        item = {
          teamId: entityId,
          teamName: resolvedName,
          teamCode: resolvedCode,
          accessCode: resolvedCode,
          totalEvents: 0,
          eventsByType: {},
          fullscreenExits: 0,
          tabHiddenCount: 0,
          blurCount: 0,
          lastEventAt: null,
          latestEventAt: null,
        };
        map.set(entityId, item);
      }

      item.totalEvents++;
      const typeKey = ev.eventType || 'UNKNOWN';
      item.eventsByType[typeKey] = (item.eventsByType[typeKey] || 0) + 1;
      if (ev.eventType === 'FULLSCREEN_EXIT') item.fullscreenExits++;
      if (ev.eventType === 'TAB_HIDDEN') item.tabHiddenCount++;
      if (ev.eventType === 'WINDOW_BLUR') item.blurCount++;

      const evDate = new Date(ev.createdAt);
      if (!item.lastEventAt || evDate > item.lastEventAt) {
        item.lastEventAt = evDate;
        item.latestEventAt = evDate.toISOString();
      }
    }

    return Array.from(map.values()).sort((a, b) => b.totalEvents - a.totalEvents);
  }
}

export const antiCheatRepository = new AntiCheatRepository();

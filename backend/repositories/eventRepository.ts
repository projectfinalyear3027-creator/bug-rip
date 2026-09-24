/**
 * BUG RIP - Event Repository
 * Authoritative competition state, leaderboard ranking, and audit logs.
 */

import { eq, and, desc, asc, sql } from 'drizzle-orm';
import { db } from '../../src/db/index.ts';
import {
  eventSettings,
  auditLogs,
  teams,
  teamChallenges,
  challenges,
  competitionMatches,
} from '../../src/db/schema.ts';
import { teamRepository } from './teamRepository.ts';

export class EventRepository {
  /**
   * Fetch current event settings (Single-row authoritative configuration)
   */
  async getEventSettings() {
    const res = await db
      .select()
      .from(eventSettings)
      .where(eq(eventSettings.id, 1))
      .limit(1);

    return res[0] || null;
  }

  /**
   * Update event status (NOT_STARTED, RUNNING, PAUSED, ENDED)
   */
  async updateEventStatus(
    status: 'NOT_STARTED' | 'RUNNING' | 'PAUSED' | 'ENDED',
    fields: Partial<{
      startedAt: Date;
      endedAt: Date;
      pausedAt: Date;
      totalPausedDurationSeconds: number;
    }> = {}
  ) {
    const res = await db
      .update(eventSettings)
      .set({
        status,
        ...fields,
        updatedAt: new Date(),
      })
      .where(eq(eventSettings.id, 1))
      .returning();

    return res[0];
  }

  /**
   * Automatically ends an expired event with audit trail.
   * Atomically transitions only if current status is RUNNING.
   */
  async autoEndEvent(endedAt: Date, reason = 'Authoritative 60-minute duration elapsed.') {
    const updated = await db
      .update(eventSettings)
      .set({
        status: 'ENDED',
        endedAt,
        updatedAt: new Date(),
      })
      .where(and(eq(eventSettings.id, 1), eq(eventSettings.status, 'RUNNING')))
      .returning();

    if (updated.length > 0) {
      try {
        const matchNum = updated[0].currentMatchNumber || 1;
        const finalLb = await this.getLeaderboard();
        await db
          .update(competitionMatches)
          .set({
            status: 'ENDED',
            endedAt,
            finalLeaderboard: finalLb,
            endedReason: reason,
            updatedAt: new Date(),
          })
          .where(eq(competitionMatches.matchNumber, matchNum));
      } catch (err) {
        console.warn('AutoEnd match update warning:', err);
      }

      await this.recordAuditLog({
        action: 'EVENT_ENDED',
        targetType: 'EVENT_SETTINGS',
        targetId: '1',
        reason,
        metadata: {
          previousStatus: 'RUNNING',
          newStatus: 'ENDED',
          autoEnded: true,
          endedAt: endedAt.toISOString(),
        },
      });
      return updated[0];
    }
    return null;
  }

  /**
   * Record audit log
   */
  async recordAuditLog(params: {
    adminUserId?: string;
    action: string;
    targetType?: string;
    targetId?: string;
    reason?: string;
    metadata?: any;
  }) {
    const res = await db
      .insert(auditLogs)
      .values({
        adminUserId: params.adminUserId,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId,
        reason: params.reason,
        metadata: params.metadata,
      })
      .returning();

    return res[0];
  }

  /**
   * Query recent audit logs
   */
  async getAuditLogs(limit: number = 50, offset: number = 0) {
    return await db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset);
  }

  /**
   * AUTHORITATIVE LEADERBOARD QUERY
   * 
   * Canonical Solo Competition Model:
   * Ranks INDIVIDUAL PARTICIPANTS
   * 
   * Permanent Invariant Ranking Order:
   * 1. Problems Solved DESC (PRIMARY)
   * 2. Total Score DESC     (SECONDARY)
   * 3. Earliest Solve Timestamp ASC (TIEBREAKER)
   * 4. Participant Name ASC (DETERMINISTIC FINAL TIEBREAKER)
   */
  async getLeaderboard() {
    // Clean up stale sessions first so active session count is fresh and authoritative
    try {
      await teamRepository.cleanupStaleSessions();
    } catch {
      // Best-effort cleanup
    }

    const query = sql`
      WITH combined_units AS (
        SELECT 
          p.id AS "unitId",
          p.id AS "participantId",
          p.id AS "teamId",
          p.name AS "participantName",
          p.name AS "teamName",
          COALESCE(p.college, 'Independent') AS "college",
          COALESCE(p.participant_code, '') AS "participantCode",
          1 AS "registeredMemberCount",
          (
            SELECT COUNT(*)::int 
            FROM sessions s 
            WHERE (s.participant_id = p.id OR s.team_id = p.id)
              AND s.status = 'ACTIVE' 
              AND s.last_heartbeat_at > NOW() - INTERVAL '3 minutes'
          ) AS "activeSessionCount",
          (
            SELECT COUNT(DISTINCT challenge_id)::int
            FROM (
              SELECT challenge_id FROM participant_challenges WHERE participant_id = p.id AND status = 'COMPLETED'
              UNION
              SELECT challenge_id FROM team_challenges WHERE team_id = p.id AND status = 'COMPLETED'
            ) solves
          ) AS "problemsSolved",
          COALESCE((
            SELECT SUM(c.score)::int
            FROM challenges c
            WHERE c.id IN (
              SELECT challenge_id FROM participant_challenges WHERE participant_id = p.id AND status = 'COMPLETED'
              UNION
              SELECT challenge_id FROM team_challenges WHERE team_id = p.id AND status = 'COMPLETED'
            )
          ), 0) AS "totalScore",
          COALESCE(
            (
              SELECT MAX(ts) FROM (
                SELECT MAX(completion_timestamp) AS ts FROM participant_challenges WHERE participant_id = p.id AND status = 'COMPLETED'
                UNION ALL
                SELECT MAX(completion_timestamp) AS ts FROM team_challenges WHERE team_id = p.id AND status = 'COMPLETED'
              ) sub
            ),
            p.created_at
          ) AS "lastSolveTimestamp",
          p.created_at
        FROM participants p
        WHERE p.status = 'ACTIVE'
          AND p.id NOT IN (SELECT participant_id FROM team_members WHERE participant_id IS NOT NULL)

        UNION ALL

        SELECT 
          t.id AS "unitId",
          t.id AS "participantId",
          t.id AS "teamId",
          t.team_name AS "participantName",
          t.team_name AS "teamName",
          'Team' AS "college",
          COALESCE(t.team_code, '') AS "participantCode",
          COALESCE(t.registered_member_count, 1) AS "registeredMemberCount",
          (
            SELECT COUNT(*)::int 
            FROM sessions s 
            WHERE s.team_id = t.id 
              AND s.status = 'ACTIVE' 
              AND s.last_heartbeat_at > NOW() - INTERVAL '3 minutes'
          ) AS "activeSessionCount",
          COUNT(tc.challenge_id) FILTER (WHERE tc.status = 'COMPLETED')::int AS "problemsSolved",
          COALESCE(SUM(c.score) FILTER (WHERE tc.status = 'COMPLETED'), 0)::int AS "totalScore",
          COALESCE(MAX(tc.completion_timestamp) FILTER (WHERE tc.status = 'COMPLETED'), t.created_at) AS "lastSolveTimestamp",
          t.created_at
        FROM teams t
        LEFT JOIN team_challenges tc ON t.id = tc.team_id
        LEFT JOIN challenges c ON tc.challenge_id = c.id
        WHERE t.status = 'ACTIVE'
          AND t.id NOT IN (SELECT id FROM participants)
        GROUP BY t.id, t.team_name, t.team_code, t.registered_member_count, t.created_at
      )
      SELECT *
      FROM combined_units
      ORDER BY 
        "problemsSolved" DESC,
        "totalScore" DESC,
        "lastSolveTimestamp" ASC,
        "teamName" ASC;
    `;

    const rows: any = await db.execute(query);
    const list = rows.rows || rows;

    return list.map((r: any, idx: number) => {
      const activeSessions = Number(r.activeSessionCount || 0);
      const isConnected = activeSessions > 0;
      return {
        rank: idx + 1,
        participantId: r.participantId,
        participantName: r.participantName,
        college: r.college,
        participantCode: r.participantCode,
        isConnected,
        problemsSolved: Number(r.problemsSolved || 0),
        score: Number(r.totalScore || 0),
        lastSolveTimestamp: new Date(r.lastSolveTimestamp).toISOString(),
        // Backward compatibility properties for components
        teamId: r.teamId,
        teamName: r.teamName,
        registeredMemberCount: Number(r.registeredMemberCount || 1),
        connectedMemberCount: activeSessions,
      };
    });
  }
}

export const eventRepository = new EventRepository();

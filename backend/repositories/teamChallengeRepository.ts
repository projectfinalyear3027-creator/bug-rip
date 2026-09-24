/**
 * BUG RIP - Team Challenge Repository
 * Enforces shared team progress and atomic same-challenge submission protection.
 * Only the first valid submission records completion.
 */

import { eq, and, or, sql } from 'drizzle-orm';
import { db } from '../../src/db/index.ts';
import {
  teamChallenges,
  participantChallenges,
  challenges,
  submissions,
  flagSubmissions,
  eventSettings,
  participants,
  teams,
} from '../../src/db/schema.ts';

async function resolveEntities(participantCandidate?: string, teamCandidate?: string): Promise<{
  participantId: string | null;
  teamId: string | null;
}> {
  let participantId: string | null = null;
  let teamId: string | null = null;

  if (participantCandidate) {
    const p = await db
      .select({ id: participants.id })
      .from(participants)
      .where(eq(participants.id, participantCandidate))
      .limit(1);
    if (p.length > 0) {
      participantId = p[0].id;
    }
  }

  if (!participantId && teamCandidate) {
    const p = await db
      .select({ id: participants.id })
      .from(participants)
      .where(eq(participants.id, teamCandidate))
      .limit(1);
    if (p.length > 0) {
      participantId = p[0].id;
    }
  }

  if (teamCandidate) {
    const t = await db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.id, teamCandidate))
      .limit(1);
    if (t.length > 0) {
      teamId = t[0].id;
    }
  }

  if (!teamId && participantCandidate) {
    const t = await db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.id, participantCandidate))
      .limit(1);
    if (t.length > 0) {
      teamId = t[0].id;
    }
  }

  return { participantId, teamId };
}

export class TeamChallengeRepository {
  /**
   * Get participant challenge state for a specific challenge
   */
  async getParticipantChallenge(participantId: string, challengeId: string) {
    const res = await db
      .select()
      .from(participantChallenges)
      .where(
        and(
          eq(participantChallenges.participantId, participantId),
          eq(participantChallenges.challengeId, challengeId)
        )
      )
      .limit(1);

    if (res[0]) return res[0];

    // Fallback to teamChallenges
    const teamRes = await db
      .select()
      .from(teamChallenges)
      .where(
        and(
          eq(teamChallenges.teamId, participantId),
          eq(teamChallenges.challengeId, challengeId)
        )
      )
      .limit(1);

    return teamRes[0] || null;
  }

  /**
   * Get team challenge state for a specific challenge (backward compatibility)
   */
  async getTeamChallenge(teamId: string, challengeId: string) {
    return this.getParticipantChallenge(teamId, challengeId);
  }

  /**
   * Get all completed challenge IDs for an individual participant
   */
  async getCompletedChallengeIds(targetId: string): Promise<string[]> {
    const res = await db
      .select({ challengeId: participantChallenges.challengeId })
      .from(participantChallenges)
      .where(
        and(
          eq(participantChallenges.participantId, targetId),
          eq(participantChallenges.status, 'COMPLETED')
        )
      );

    if (res.length > 0) {
      return res.map((r) => r.challengeId);
    }

    // Fallback: check legacy team_challenges
    const teamRes = await db
      .select({ challengeId: teamChallenges.challengeId })
      .from(teamChallenges)
      .where(
        and(
          eq(teamChallenges.teamId, targetId),
          eq(teamChallenges.status, 'COMPLETED')
        )
      );

    return teamRes.map((r) => r.challengeId);
  }

  /**
   * Authoritative Progress Calculation for a solo participant
   * Solved count and score derived directly from completed challenge records
   */
  async getParticipantProgressSummary(participantId: string): Promise<{
    problemsSolved: number;
    totalScore: number;
    lastSolveTimestamp: Date | null;
  }> {
    const res = await db
      .select({
        problemsSolved: sql<number>`COUNT(${participantChallenges.challengeId})::int`,
        totalScore: sql<number>`COALESCE(SUM(${challenges.score}), 0)::int`,
        lastSolveTimestamp: sql<Date | null>`MAX(${participantChallenges.completionTimestamp})`,
      })
      .from(participantChallenges)
      .innerJoin(challenges, eq(participantChallenges.challengeId, challenges.id))
      .where(
        and(
          eq(participantChallenges.participantId, participantId),
          eq(participantChallenges.status, 'COMPLETED')
        )
      );

    const row = res[0];
    if (row && Number(row.problemsSolved) > 0) {
      return {
        problemsSolved: Number(row.problemsSolved),
        totalScore: Number(row.totalScore),
        lastSolveTimestamp: row.lastSolveTimestamp ?? null,
      };
    }

    // Fallback to legacy team_challenges
    const legacy = await db
      .select({
        problemsSolved: sql<number>`COUNT(${teamChallenges.challengeId})::int`,
        totalScore: sql<number>`COALESCE(SUM(${challenges.score}), 0)::int`,
        lastSolveTimestamp: sql<Date | null>`MAX(${teamChallenges.completionTimestamp})`,
      })
      .from(teamChallenges)
      .innerJoin(challenges, eq(teamChallenges.challengeId, challenges.id))
      .where(
        and(
          eq(teamChallenges.teamId, participantId),
          eq(teamChallenges.status, 'COMPLETED')
        )
      );

    const lRow = legacy[0];
    return {
      problemsSolved: Number(lRow?.problemsSolved ?? 0),
      totalScore: Number(lRow?.totalScore ?? 0),
      lastSolveTimestamp: lRow?.lastSolveTimestamp ?? null,
    };
  }

  /**
   * Authoritative Team Progress Calculation (backward compatibility)
   */
  async getTeamProgressSummary(teamId: string) {
    return this.getParticipantProgressSummary(teamId);
  }

  /**
   * ATOMIC SOLVE RECORDING
   * Records solve attempt for individual participant.
   */
  async recordSolveAttempt(params: {
    participantId?: string;
    teamId: string;
    challengeId: string;
    sessionId?: string;
  }): Promise<{ accepted: boolean; message: string; pointsAwarded: number }> {
    const now = new Date();
    const effectiveParticipantId = params.participantId || params.teamId;

    // Check challenge points
    const chal = await db
      .select({ score: challenges.score })
      .from(challenges)
      .where(eq(challenges.id, params.challengeId))
      .limit(1);

    const score = chal[0]?.score ?? 10;

    // Check if participant already solved this challenge
    const existing = await this.getParticipantChallenge(effectiveParticipantId, params.challengeId);
    if (existing && existing.status === 'COMPLETED') {
      return {
        accepted: false,
        message: 'This problem has already been completed.',
        pointsAwarded: 0,
      };
    }

    let recorded = false;
    try {
      // Upsert into participant_challenges
      try {
        await db
          .insert(participantChallenges)
          .values({
            participantId: effectiveParticipantId,
            challengeId: params.challengeId,
            status: 'COMPLETED',
            attemptCount: 1,
            startedAt: now,
            completedAt: now,
            completionTimestamp: now,
            completedBySessionId: params.sessionId,
          })
          .onConflictDoUpdate({
            target: [participantChallenges.participantId, participantChallenges.challengeId],
            set: {
              status: 'COMPLETED',
              completedAt: now,
              completionTimestamp: now,
              completedBySessionId: params.sessionId,
            },
          });
        recorded = true;
      } catch {
        // Ignored if effectiveParticipantId is not in participants table
      }

      // Also upsert teamChallenges for backward compatibility
      try {
        await db
          .insert(teamChallenges)
          .values({
            teamId: params.teamId || effectiveParticipantId,
            challengeId: params.challengeId,
            status: 'COMPLETED',
            attemptCount: 1,
            startedAt: now,
            completedAt: now,
            completionTimestamp: now,
            completedBySessionId: params.sessionId,
          })
          .onConflictDoUpdate({
            target: [teamChallenges.teamId, teamChallenges.challengeId],
            set: {
              status: 'COMPLETED',
              completedAt: now,
              completionTimestamp: now,
              completedBySessionId: params.sessionId,
            },
          });
        recorded = true;
      } catch {
        // Ignored if teamId is not in teams table
      }

      if (recorded) {
        return {
          accepted: true,
          message: 'Challenge solved successfully! Flag validated and points awarded.',
          pointsAwarded: score,
        };
      } else {
        return {
          accepted: false,
          message: 'Unable to record solve.',
          pointsAwarded: 0,
        };
      }
    } catch (err: any) {
      return {
        accepted: false,
        message: 'Unable to record solve.',
        pointsAwarded: 0,
      };
    }
  }

  /**
   * Record a Java execution submission
   */
  async recordExecutionSubmission(params: {
    participantId?: string;
    teamId: string;
    challengeId: string;
    sessionId?: string;
    sourceCode: string;
    executionStatus:
      | 'QUEUED'
      | 'RUNNING'
      | 'SUCCESS'
      | 'COMPILE_ERROR'
      | 'RUNTIME_ERROR'
      | 'TIMEOUT'
      | 'MEMORY_LIMIT'
      | 'OUTPUT_LIMIT'
      | 'SANDBOX_ERROR'
      | 'QUEUE_ERROR';
    stdout?: string;
    stderr?: string;
    executionTimeMs?: number;
    memoryUsedBytes?: number;
  }) {
    const currentEvt = await db
      .select({
        matchNumber: eventSettings.currentMatchNumber,
        matchId: eventSettings.currentMatchId,
      })
      .from(eventSettings)
      .where(eq(eventSettings.id, 1))
      .limit(1);

    const matchNumber = currentEvt[0]?.matchNumber || 1;
    const matchId = currentEvt[0]?.matchId || null;
    const { participantId, teamId } = await resolveEntities(params.participantId, params.teamId);

    const res = await db
      .insert(submissions)
      .values({
        participantId,
        teamId,
        challengeId: params.challengeId,
        sessionId: params.sessionId,
        sourceCode: params.sourceCode,
        executionStatus: params.executionStatus,
        stdout: params.stdout,
        stderr: params.stderr,
        executionTimeMs: params.executionTimeMs,
        memoryUsedBytes: params.memoryUsedBytes,
        matchNumber,
        matchId,
      })
      .returning();

    // Increment informational attempt_count in participant_challenges if participant known
    if (participantId) {
      try {
        await db
          .insert(participantChallenges)
          .values({
            participantId,
            challengeId: params.challengeId,
            status: 'IN_PROGRESS',
            attemptCount: 1,
            startedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [participantChallenges.participantId, participantChallenges.challengeId],
            set: {
              attemptCount: sql`${participantChallenges.attemptCount} + 1`,
            },
          });
      } catch {}
    }

    // Also update team_challenges if team known
    if (teamId) {
      try {
        await db
          .insert(teamChallenges)
          .values({
            teamId,
            challengeId: params.challengeId,
            status: 'IN_PROGRESS',
            attemptCount: 1,
            startedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [teamChallenges.teamId, teamChallenges.challengeId],
            set: {
              attemptCount: sql`${teamChallenges.attemptCount} + 1`,
            },
          });
      } catch {}
    }

    return res[0];
  }

  /**
   * Update an existing execution submission record
   */
  async updateExecutionSubmission(
    id: string,
    updates: {
      executionStatus?:
        | 'QUEUED'
        | 'RUNNING'
        | 'SUCCESS'
        | 'COMPILE_ERROR'
        | 'RUNTIME_ERROR'
        | 'TIMEOUT'
        | 'MEMORY_LIMIT'
        | 'OUTPUT_LIMIT'
        | 'SANDBOX_ERROR'
        | 'QUEUE_ERROR';
      stdout?: string;
      stderr?: string;
      executionTimeMs?: number;
      memoryUsedBytes?: number;
      startedAt?: Date;
      completedAt?: Date;
      workerId?: string;
      behaviorStatus?: string;
      behaviorDiagnostics?: any;
      revealedFlag?: string;
    }
  ) {
    const res = await db
      .update(submissions)
      .set(updates)
      .where(eq(submissions.id, id))
      .returning();

    return res[0] || null;
  }

  /**
   * Get latest successful and behavior-validated execution for a team & challenge
   */
  async getLatestValidatedExecution(teamId: string, challengeId: string) {
    const res = await db
      .select()
      .from(submissions)
      .where(
        and(
          or(
            eq(submissions.teamId, teamId),
            eq(submissions.participantId, teamId)
          ),
          eq(submissions.challengeId, challengeId),
          eq(submissions.executionStatus, 'SUCCESS'),
          eq(submissions.behaviorStatus, 'PASS')
        )
      )
      .orderBy(sql`${submissions.createdAt} DESC`)
      .limit(1);

    return res[0] || null;
  }

  /**
   * Get submission by ID (with optional teamId / participantId verification)
   */
  async getSubmissionById(id: string, teamOrParticipantId?: string) {
    const conditions = [eq(submissions.id, id)];
    if (teamOrParticipantId) {
      conditions.push(
        or(
          eq(submissions.teamId, teamOrParticipantId),
          eq(submissions.participantId, teamOrParticipantId)
        )!
      );
    }

    const res = await db
      .select()
      .from(submissions)
      .where(and(...conditions))
      .limit(1);

    return res[0] || null;
  }

  /**
   * Record a flag submission attempt
   */
  async recordFlagSubmission(params: {
    participantId?: string;
    teamId: string;
    challengeId: string;
    sessionId?: string;
    submittedFlagHash: string;
    valid: boolean;
  }) {
    const { participantId, teamId } = await resolveEntities(params.participantId, params.teamId);

    const res = await db
      .insert(flagSubmissions)
      .values({
        participantId,
        teamId,
        challengeId: params.challengeId,
        sessionId: params.sessionId,
        submittedFlagHash: params.submittedFlagHash,
        valid: params.valid,
      })
      .returning();

    return res[0];
  }
}

export const teamChallengeRepository = new TeamChallengeRepository();

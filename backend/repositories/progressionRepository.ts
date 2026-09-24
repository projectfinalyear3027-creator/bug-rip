/**
 * BUG RIP - Progression Repository
 * Tracks team-specific unlocked difficulties and administrative progression overrides.
 * Enforces monotonic unlock retention and shared team challenge progress.
 */

import { eq, and, or, isNull } from 'drizzle-orm';
import { db } from '../../src/db/index.ts';
import {
  teamUnlockedRounds,
  participantUnlockedRounds,
  progressionOverrides,
  teamChallenges,
  participantChallenges,
  eventSettings,
  participants,
  teams,
} from '../../src/db/schema.ts';

export class ProgressionRepository {
  /**
   * Get all round IDs explicitly unlocked for an individual participant
   */
  async getParticipantUnlockedRoundIds(participantId: string): Promise<string[]> {
    const res = await db
      .select({ roundId: participantUnlockedRounds.roundId })
      .from(participantUnlockedRounds)
      .where(eq(participantUnlockedRounds.participantId, participantId));

    if (res.length > 0) {
      return res.map((r) => r.roundId);
    }

    // Fallback: check legacy team_unlocked_rounds for backwards compatibility
    const legacy = await db
      .select({ roundId: teamUnlockedRounds.roundId })
      .from(teamUnlockedRounds)
      .where(eq(teamUnlockedRounds.teamId, participantId));

    return legacy.map((r) => r.roundId);
  }

  /**
   * Persist a round unlock for a solo participant monotonically
   */
  async recordParticipantRoundUnlock(
    participantId: string,
    roundId: string,
    reason: string = 'THRESHOLD_REACHED'
  ) {
    try {
      await db
        .insert(participantUnlockedRounds)
        .values({
          participantId,
          roundId,
          unlockedReason: reason,
        })
        .onConflictDoNothing();
    } catch {
      // Ignored if participantId is not in participants table (e.g. legacy team id)
    }

    // Also write to team_unlocked_rounds for legacy compatibility
    try {
      await db
        .insert(teamUnlockedRounds)
        .values({
          teamId: participantId,
          roundId,
          unlockedReason: reason,
        })
        .onConflictDoNothing();
    } catch {
      // Ignored if participantId is not in teams table
    }
  }

  /**
   * Get all round IDs explicitly unlocked for a team (backward compatibility)
   */
  async getTeamUnlockedRoundIds(teamId: string): Promise<string[]> {
    return this.getParticipantUnlockedRoundIds(teamId);
  }

  /**
   * Persist a round unlock for a team monotonically (backward compatibility)
   */
  async recordRoundUnlock(
    teamId: string,
    roundId: string,
    reason: string = 'THRESHOLD_REACHED'
  ) {
    return this.recordParticipantRoundUnlock(teamId, roundId, reason);
  }

  /**
   * Check if global "UNLOCK_ALL" override is active
   */
  async isUnlockAllActive(): Promise<boolean> {
    const settings = await db
      .select({ progressionMode: eventSettings.progressionMode })
      .from(eventSettings)
      .where(eq(eventSettings.id, 1))
      .limit(1);

    return settings[0]?.progressionMode === 'UNLOCK_ALL';
  }

  /**
   * Get active manual progression overrides for a participant/team
   */
  async getActiveOverrides(targetId?: string) {
    if (targetId) {
      return await db
        .select()
        .from(progressionOverrides)
        .where(
          or(
            and(isNull(progressionOverrides.teamId), isNull(progressionOverrides.participantId)),
            eq(progressionOverrides.participantId, targetId),
            eq(progressionOverrides.teamId, targetId)
          )
        );
    }

    return await db.select().from(progressionOverrides);
  }

  /**
   * Insert an administrative override
   */
  async addOverride(data: {
    targetType: 'ALL_DIFFICULTIES' | 'ROUND' | 'CHALLENGE';
    targetId?: string;
    teamId?: string;
    participantId?: string;
    adminUserId?: string;
    reason?: string;
  }) {
    let resolvedParticipantId: string | null = null;
    let resolvedTeamId: string | null = null;

    const idToCheck = data.participantId || data.teamId;
    if (idToCheck) {
      const isParticipant = await db
        .select({ id: participants.id })
        .from(participants)
        .where(eq(participants.id, idToCheck))
        .limit(1);

      if (isParticipant.length > 0) {
        resolvedParticipantId = isParticipant[0].id;
      } else {
        const isTeam = await db
          .select({ id: teams.id })
          .from(teams)
          .where(eq(teams.id, idToCheck))
          .limit(1);

        if (isTeam.length > 0) {
          resolvedTeamId = isTeam[0].id;
        } else {
          resolvedTeamId = data.teamId || null;
          resolvedParticipantId = data.participantId || null;
        }
      }
    }

    const res = await db
      .insert(progressionOverrides)
      .values({
        targetType: data.targetType,
        targetId: data.targetId,
        teamId: resolvedTeamId,
        participantId: resolvedParticipantId,
        adminUserId: data.adminUserId,
        reason: data.reason,
      })
      .returning();

    return res[0];
  }

  /**
   * Unlock all difficulties globally via event settings
   */
  async setProgressionMode(mode: 'SEQUENTIAL' | 'UNLOCK_ALL' | 'CUSTOM') {
    await db
      .update(eventSettings)
      .set({
        progressionMode: mode,
        updatedAt: new Date(),
      })
      .where(eq(eventSettings.id, 1));

    if (mode === 'SEQUENTIAL') {
      await db
        .delete(progressionOverrides)
        .where(eq(progressionOverrides.targetType, 'ALL_DIFFICULTIES'));
    }
  }

  /**
   * Get participant challenge statuses for an individual competitor
   */
  async getParticipantChallenges(participantId: string) {
    const rows = await db
      .select()
      .from(participantChallenges)
      .where(eq(participantChallenges.participantId, participantId));

    if (rows.length > 0) {
      return rows;
    }

    // Fallback: check legacy team_challenges
    return await db
      .select()
      .from(teamChallenges)
      .where(eq(teamChallenges.teamId, participantId));
  }

  /**
   * Get team challenge statuses for a team (backward compatibility)
   */
  async getTeamChallenges(teamId: string) {
    return this.getParticipantChallenges(teamId);
  }

  /**
   * Set specific challenge status for an individual participant
   */
  async setParticipantChallengeStatus(
    participantId: string,
    challengeId: string,
    status: 'LOCKED' | 'AVAILABLE' | 'IN_PROGRESS' | 'COMPLETED'
  ) {
    try {
      await db
        .insert(participantChallenges)
        .values({
          participantId,
          challengeId,
          status,
          attemptCount: 0,
          unlockedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [participantChallenges.participantId, participantChallenges.challengeId],
          set: {
            status,
            updatedAt: new Date(),
          },
        });
    } catch {
      // Ignored if participantId is not in participants table
    }

    // Also write to team_challenges
    try {
      await db
        .insert(teamChallenges)
        .values({
          teamId: participantId,
          challengeId,
          status,
          attemptCount: 0,
          unlockedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [teamChallenges.teamId, teamChallenges.challengeId],
          set: {
            status,
            updatedAt: new Date(),
          },
        });
    } catch {
      // Ignored if participantId is not in teams table
    }
  }

  /**
   * Set specific challenge status for a team (backward compatibility)
   */
  async setChallengeStatus(
    teamId: string,
    challengeId: string,
    status: 'LOCKED' | 'AVAILABLE' | 'IN_PROGRESS' | 'COMPLETED'
  ) {
    return this.setParticipantChallengeStatus(teamId, challengeId, status);
  }
}

export const progressionRepository = new ProgressionRepository();

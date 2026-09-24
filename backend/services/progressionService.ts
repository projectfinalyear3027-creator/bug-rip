/**
 * BUG RIP - Progression Service
 * Enforces canonical difficulty progression, free choice within unlocked difficulties,
 * monotonic unlock retention, and administrative overrides.
 */

import { AppError } from '../middleware/errorHandler.ts';
import { challengeRepository } from '../repositories/challengeRepository.ts';
import { teamChallengeRepository } from '../repositories/teamChallengeRepository.ts';
import { progressionRepository } from '../repositories/progressionRepository.ts';
import { adminRepository } from '../repositories/adminRepository.ts';
import { eventService } from './eventService.ts';
import { db } from '../../src/db/index.ts';
import { teamChallenges, participantChallenges, challenges } from '../../src/db/schema.ts';
import { eq, and } from 'drizzle-orm';
import { toParticipantChallengeDTO } from '../rules/participantDataSecurity.ts';
import type { ParticipantChallengeDTO } from '../types/competition.ts';

export interface RoundProgressionInfo {
  id: string;
  name: string;
  slug: string;
  displayOrder: number;
  isActive: boolean;
  isUnlocked: boolean;
  unlockRequiredSolves: number;
  solvesInPrecedingRound?: number;
  activeChallengesCount: number;
  totalChallengesCount: number;
  completedByTeamCount: number;
  unlockWarning?: string | null;
}

export class ProgressionService {
  /**
   * Determine authoritative difficulty progression and challenge status for a team
   */
  async getTeamProgression(teamId: string) {
    // 1. Fetch active rounds sorted by display order
    const activeRounds = await challengeRepository.getRounds();
    if (activeRounds.length === 0) {
      return {
        rounds: [],
        challenges: [],
        stats: {
          problemsSolved: 0,
          totalScore: 0,
          unlockedRoundsCount: 0,
          totalRoundsCount: 0,
        },
      };
    }

    // 2. Check if UNLOCK_ALL is active
    const isUnlockAll = await progressionRepository.isUnlockAllActive();

    // 3. Get team's monotonic historically unlocked rounds
    const previouslyUnlockedRoundIds = new Set(
      await progressionRepository.getTeamUnlockedRoundIds(teamId)
    );

    // 4. Get active overrides for this team
    const overrides = await progressionRepository.getActiveOverrides(teamId);
    const overriddenRoundIds = new Set(
      overrides
        .filter((o) => o.targetType === 'ROUND' && o.targetId)
        .map((o) => o.targetId as string)
    );
    const overriddenChallengeIds = new Set(
      overrides
        .filter((o) => o.targetType === 'CHALLENGE' && o.targetId)
        .map((o) => o.targetId as string)
    );

    // 5. Get completed challenge records from participant_challenges (solo) and team_challenges (legacy)
    const pcSolves = await db
      .select({
        challengeId: participantChallenges.challengeId,
        roundId: challenges.roundId,
      })
      .from(participantChallenges)
      .innerJoin(challenges, eq(participantChallenges.challengeId, challenges.id))
      .where(
        and(
          eq(participantChallenges.participantId, teamId),
          eq(participantChallenges.status, 'COMPLETED')
        )
      );

    const tcSolves = await db
      .select({
        challengeId: teamChallenges.challengeId,
        roundId: challenges.roundId,
      })
      .from(teamChallenges)
      .innerJoin(challenges, eq(teamChallenges.challengeId, challenges.id))
      .where(
        and(
          eq(teamChallenges.teamId, teamId),
          eq(teamChallenges.status, 'COMPLETED')
        )
      );

    const solveMap = new Map<string, string>();
    for (const c of pcSolves) solveMap.set(c.challengeId, c.roundId);
    for (const c of tcSolves) solveMap.set(c.challengeId, c.roundId);
    const completedChallengesWithRound = Array.from(solveMap.entries()).map(([challengeId, roundId]) => ({
      challengeId,
      roundId,
    }));

    const completedChallengeIds = new Set(
      completedChallengesWithRound.map((c) => c.challengeId)
    );

    // Count solves per round
    const solvesPerRound = new Map<string, number>();
    for (const c of completedChallengesWithRound) {
      solvesPerRound.set(
        c.roundId,
        (solvesPerRound.get(c.roundId) ?? 0) + 1
      );
    }

    // 6. Calculate unlock status for each round monotonically
    const unlockedRoundIds = new Set<string>();

    for (let i = 0; i < activeRounds.length; i++) {
      const currentRound = activeRounds[i];
      let isUnlocked = false;

      if (isUnlockAll) {
        isUnlocked = true;
      } else if (i === 0) {
        // First active difficulty is always unlocked by default
        isUnlocked = true;
      } else if (previouslyUnlockedRoundIds.has(currentRound.id)) {
        // Monotonic rule: already unlocked progress stays unlocked
        isUnlocked = true;
      } else if (overriddenRoundIds.has(currentRound.id)) {
        isUnlocked = true;
      } else {
        // Threshold check from preceding difficulty
        const prevRound = activeRounds[i - 1];
        const prevRoundSolves = solvesPerRound.get(prevRound.id) ?? 0;
        const required = currentRound.unlockRequiredSolves;

        if (unlockedRoundIds.has(prevRound.id) && prevRoundSolves >= required) {
          isUnlocked = true;
          // Monotonically persist newly achieved unlock
          await progressionRepository.recordRoundUnlock(
            teamId,
            currentRound.id,
            'THRESHOLD_REACHED'
          );
        }
      }

      if (isUnlocked) {
        unlockedRoundIds.add(currentRound.id);
      }
    }

    // Always ensure the first round is persisted in team_unlocked_rounds
    if (activeRounds.length > 0) {
      await progressionRepository.recordRoundUnlock(
        teamId,
        activeRounds[0].id,
        'INITIAL'
      );
    }

    // 7. Get existing team challenges records (for attemptCount, IN_PROGRESS status)
    const existingTeamChallenges = await progressionRepository.getTeamChallenges(
      teamId
    );
    const teamChallengeMap = new Map<string, any>(
      existingTeamChallenges.map((tc: any) => [tc.challengeId, tc])
    );

    // 8. Fetch active challenges (and any completed inactive challenges)
    const activeChallenges = await challengeRepository.getChallenges();

    // Map enriched challenges with public-safe fields
    const enrichedChallenges = activeChallenges.map((c) => {
      const tc = teamChallengeMap.get(c.id);
      const isCompleted = tc?.status === 'COMPLETED';
      const isRoundUnlocked = unlockedRoundIds.has(c.roundId);
      const isIndividuallyUnlocked = overriddenChallengeIds.has(c.id);

      let status: 'LOCKED' | 'AVAILABLE' | 'IN_PROGRESS' | 'COMPLETED' = 'LOCKED';

      if (isCompleted) {
        status = 'COMPLETED';
      } else if (tc?.status === 'IN_PROGRESS' && (isRoundUnlocked || isIndividuallyUnlocked)) {
        status = 'IN_PROGRESS';
      } else if (isRoundUnlocked || isIndividuallyUnlocked) {
        status = 'AVAILABLE';
      } else {
        status = 'LOCKED';
      }

      return {
        id: c.id,
        roundId: c.roundId,
        title: c.title,
        slug: c.slug,
        score: c.score,
        displayOrder: c.displayOrder,
        validationType: c.validationType,
        timeLimitMs: c.timeLimitMs,
        memoryLimitMb: c.memoryLimitMb,
        status,
        attemptCount: tc?.attemptCount ?? 0,
      };
    });

    // 9. Enriched rounds
    const enrichedRounds: RoundProgressionInfo[] = [];
    for (let i = 0; i < activeRounds.length; i++) {
      const r = activeRounds[i];
      const activeCount = await challengeRepository.getActiveChallengesCountByRound(r.id);
      const prevRound = i > 0 ? activeRounds[i - 1] : null;
      const solvesInPreceding = prevRound ? (solvesPerRound.get(prevRound.id) ?? 0) : undefined;

      enrichedRounds.push({
        id: r.id,
        name: r.name,
        slug: r.slug,
        displayOrder: r.displayOrder,
        isActive: r.isActive,
        isUnlocked: unlockedRoundIds.has(r.id),
        unlockRequiredSolves: r.unlockRequiredSolves,
        solvesInPrecedingRound: solvesInPreceding,
        activeChallengesCount: activeCount,
        totalChallengesCount: activeCount,
        completedByTeamCount: solvesPerRound.get(r.id) ?? 0,
      });
    }

    // 10. Summary stats
    const progressSummary = await teamChallengeRepository.getTeamProgressSummary(
      teamId
    );

    return {
      rounds: enrichedRounds,
      challenges: enrichedChallenges,
      stats: {
        problemsSolved: progressSummary.problemsSolved,
        totalScore: progressSummary.totalScore,
        unlockedRoundsCount: unlockedRoundIds.size,
        totalRoundsCount: activeRounds.length,
      },
    };
  }

  /**
   * Get safe participant challenge details by ID
   * Enforces that participant team has unlocked the difficulty
   * Hides all hidden test cases and flag verifiers
   */
  async getParticipantChallengeDetails(
    teamId: string,
    challengeId: string
  ): Promise<ParticipantChallengeDTO> {
    // 1. Participant-safe database query: excludes solution_code, admin_notes, hidden tests, flag
    const chal = await challengeRepository.getParticipantChallengeById(challengeId);
    if (!chal) {
      throw new AppError('Challenge not found.', 404, 'CHALLENGE_NOT_FOUND');
    }

    // Check if team has unlocked this challenge/round
    const progression = await this.getTeamProgression(teamId);
    const targetChallenge = progression.challenges.find((c) => c.id === challengeId);

    // If challenge was completed historically, always allow viewing
    const teamChal = await teamChallengeRepository.getTeamChallenge(teamId, challengeId);
    const isCompleted = teamChal?.status === 'COMPLETED';

    if (!isCompleted) {
      if (!chal.isActive) {
        throw new AppError('This challenge is currently inactive.', 400, 'CHALLENGE_INACTIVE');
      }

      if (!targetChallenge || targetChallenge.status === 'LOCKED') {
        throw new AppError(
          'This challenge is locked. Complete the required difficulties to unlock it.',
          403,
          'CHALLENGE_LOCKED'
        );
      }
    }

    // Fetch public test cases ONLY (strictly exclude hidden tests)
    const publicTestCases = await challengeRepository.getTestCases(challengeId, false);

    // 2. Strict transformation to ParticipantChallengeDTO with anti-leak assertion
    return toParticipantChallengeDTO({
      id: chal.id,
      roundId: chal.roundId,
      title: chal.title,
      slug: chal.slug,
      description: chal.description,
      starterCode: chal.starterCode, // The buggy Java code to debug
      score: chal.score,
      displayOrder: chal.displayOrder,
      validationType: chal.validationType,
      timeLimitMs: chal.timeLimitMs,
      memoryLimitMb: chal.memoryLimitMb,
      maxOutputBytes: chal.maxOutputBytes,
      maxSourceBytes: chal.maxSourceBytes,
      status: targetChallenge?.status ?? (isCompleted ? 'COMPLETED' : 'AVAILABLE'),
      attemptCount: teamChal?.attemptCount ?? 0,
      publicTestCases: publicTestCases.map((tc) => ({
        id: tc.id,
        inputData: tc.inputData,
        expectedOutput: tc.expectedOutput,
        testType: tc.testType,
        displayOrder: tc.displayOrder,
        explanation: tc.explanation ?? null,
      })),
    });
  }

  /**
   * Validate round threshold configuration
   */
  async validateRoundThreshold(roundId: string, unlockRequiredSolves: number) {
    if (unlockRequiredSolves < 0) {
      throw new AppError('Unlock required solves cannot be negative.', 400, 'INVALID_THRESHOLD');
    }

    const allRounds = await challengeRepository.getAllRounds();
    const targetIndex = allRounds.findIndex((r) => r.id === roundId);
    if (targetIndex === -1) {
      throw new AppError('Round not found.', 404, 'ROUND_NOT_FOUND');
    }

    // If this is the first round, 0 solves is standard
    if (targetIndex === 0) {
      return { valid: true };
    }

    const precedingRound = allRounds[targetIndex - 1];
    const precedingActiveCount = await challengeRepository.getActiveChallengesCountByRound(
      precedingRound.id
    );

    if (unlockRequiredSolves > precedingActiveCount) {
      throw new AppError(
        `Invalid threshold: ${unlockRequiredSolves} solves required, but preceding difficulty "${precedingRound.name}" only has ${precedingActiveCount} active challenges.`,
        400,
        'IMPOSSIBLE_THRESHOLD'
      );
    }

    return { valid: true };
  }

  /**
   * Check if deactivating a challenge causes any downstream unlock threshold to become invalid
   */
  async checkDeactivationImpact(challengeId: string) {
    const chal = await challengeRepository.getChallengeById(challengeId);
    if (!chal) {
      throw new AppError('Challenge not found.', 404, 'CHALLENGE_NOT_FOUND');
    }

    if (!chal.isActive) {
      return { warning: null };
    }

    const allRounds = await challengeRepository.getAllRounds();
    const roundIndex = allRounds.findIndex((r) => r.id === chal.roundId);
    if (roundIndex === -1 || roundIndex === allRounds.length - 1) {
      return { warning: null };
    }

    const currentRound = allRounds[roundIndex];
    const nextRound = allRounds[roundIndex + 1];

    const currentActiveCount = await challengeRepository.getActiveChallengesCountByRound(
      currentRound.id
    );
    const newActiveCount = Math.max(0, currentActiveCount - 1);

    if (nextRound.unlockRequiredSolves > newActiveCount) {
      const warning = `UNLOCK CONFIGURATION INVALID: ${newActiveCount} active challenges remain in "${currentRound.name}", but ${nextRound.unlockRequiredSolves} solves are required to unlock "${nextRound.name}". Require the organizer to resolve the configuration.`;
      return { warning };
    }

    return { warning: null };
  }

  /**
   * Get all rounds with configuration validation alerts for admin
   */
  async getRoundsWithValidation() {
    const metrics = await challengeRepository.getRoundMetrics();
    const result = [];

    for (let i = 0; i < metrics.length; i++) {
      const m = metrics[i];
      let warning: string | null = null;

      if (i > 0) {
        const prev = metrics[i - 1];
        if (m.round.unlockRequiredSolves > prev.activeChallengesCount) {
          warning = `UNLOCK CONFIGURATION INVALID: Preceding round "${prev.round.name}" has ${prev.activeChallengesCount} active challenges, but ${m.round.unlockRequiredSolves} solves are required to unlock "${m.round.name}".`;
        }
      }

      result.push({
        ...m.round,
        activeChallengesCount: m.activeChallengesCount,
        totalChallengesCount: m.totalChallengesCount,
        warning,
      });
    }

    return result;
  }

  /**
   * ADMIN: Unlock all difficulties for all teams
   */
  async unlockAllDifficulties(adminUserId?: string, reason?: string) {
    await progressionRepository.setProgressionMode('UNLOCK_ALL');
    await progressionRepository.addOverride({
      targetType: 'ALL_DIFFICULTIES',
      adminUserId,
      reason: reason || 'Administrative unlock all difficulties override',
    });

    await adminRepository.recordAuditLog({
      adminUserId,
      action: 'ALL_DIFFICULTIES_UNLOCKED',
      targetType: 'PROGRESSION',
      targetId: 'ALL',
      reason: reason || 'Organizer triggered unlock all difficulties',
    });

    return { success: true, message: 'All difficulties unlocked for all participants.' };
  }

  /**
   * ADMIN: Unlock difficulty for one team or all teams
   */
  async unlockDifficulty(
    roundId: string,
    teamId?: string,
    adminUserId?: string,
    reason?: string
  ) {
    const round = await challengeRepository.getRoundById(roundId);
    if (!round) {
      throw new AppError('Round not found.', 404, 'ROUND_NOT_FOUND');
    }

    await progressionRepository.addOverride({
      targetType: 'ROUND',
      targetId: roundId,
      teamId,
      adminUserId,
      reason: reason || `Admin manual unlock for round ${round.name}`,
    });

    if (teamId) {
      await progressionRepository.recordRoundUnlock(teamId, roundId, 'ADMIN_OVERRIDE');
    }

    await adminRepository.recordAuditLog({
      adminUserId,
      action: 'DIFFICULTY_MANUALLY_UNLOCKED',
      targetType: 'ROUND',
      targetId: roundId,
      reason: reason || `Manual unlock for ${round.name}${teamId ? ` (team: ${teamId})` : ' (all teams)'}`,
    });

    return {
      success: true,
      message: `Difficulty "${round.name}" successfully unlocked${teamId ? ' for team' : ' for all teams'}.`,
    };
  }

  /**
   * ADMIN: Unlock challenge for one team or all teams
   */
  async unlockChallenge(
    challengeId: string,
    teamId?: string,
    adminUserId?: string,
    reason?: string
  ) {
    const chal = await challengeRepository.getChallengeById(challengeId);
    if (!chal) {
      throw new AppError('Challenge not found.', 404, 'CHALLENGE_NOT_FOUND');
    }

    await progressionRepository.addOverride({
      targetType: 'CHALLENGE',
      targetId: challengeId,
      teamId,
      adminUserId,
      reason: reason || `Admin manual unlock for challenge ${chal.title}`,
    });

    if (teamId) {
      await progressionRepository.setChallengeStatus(teamId, challengeId, 'AVAILABLE');
    }

    await adminRepository.recordAuditLog({
      adminUserId,
      action: 'CHALLENGE_MANUALLY_UNLOCKED',
      targetType: 'CHALLENGE',
      targetId: challengeId,
      reason: reason || `Manual unlock for challenge "${chal.title}"${teamId ? ` (team: ${teamId})` : ' (all teams)'}`,
    });

    return {
      success: true,
      message: `Challenge "${chal.title}" successfully unlocked${teamId ? ' for team' : ' for all teams'}.`,
    };
  }
}

export const progressionService = new ProgressionService();

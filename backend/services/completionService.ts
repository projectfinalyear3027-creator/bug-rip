/**
 * BUG RIP - Authoritative Challenge Completion Service (Fragment 9)
 * 
 * Implements the atomic CTF completion pipeline:
 * 1. Event State Verification (Must be RUNNING; blocks if PAUSED, ENDED, NOT_STARTED).
 * 2. Challenge Accessibility & Active Status Check.
 * 3. Idempotent / Same-Challenge Race Protection (First team completion wins).
 * 4. Flag Format Validation (DBG{...}).
 * 5. Server-side Authoritative Flag Verifier (Constant-time hash comparison).
 * 6. Execution Tie-in & Behavioral Validation Verification (Anti-fake flag protection).
 * 7. Single Atomic Database Transaction:
 *    - Updates team_challenges to COMPLETED.
 *    - Records valid/invalid flag attempt in flag_submissions.
 *    - Evaluates difficulty progression based on unique solved count.
 *    - Awards challenge points.
 *    - Records authoritative audit logs.
 */

import crypto from 'crypto';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../../src/db/index.ts';
import {
  challenges,
  challengeFlags,
  teamChallenges,
  participantChallenges,
  flagSubmissions,
  submissions,
  auditLogs,
  eventSettings,
  participants,
  teams,
} from '../../src/db/schema.ts';
import { eventService } from './eventService.ts';
import { progressionService } from './progressionService.ts';
import { challengeRepository } from '../repositories/challengeRepository.ts';
import { teamChallengeRepository } from '../repositories/teamChallengeRepository.ts';
import { teamRealtimeService } from './teamRealtimeService.ts';
import { leaderboardRealtimeService } from './leaderboardRealtimeService.ts';

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

export interface SubmitFlagParams {
  participantId?: string;
  teamId?: string;
  challengeId: string;
  submittedFlag: string;
  sessionId?: string;
  executionId?: string;
}

export interface CompletionResult {
  success: boolean;
  accepted: boolean;
  code: string;
  message: string;
  alreadyCompleted?: boolean;
  data?: {
    challengeId: string;
    pointsAwarded: number;
    problemsSolved: number;
    totalScore: number;
    unlockedRounds: string[];
  };
}

export class CompletionService {
  /**
   * Authoritative Flag Pattern: DBG{...}
   */
  private static readonly FLAG_PATTERN = /^DBG\{[A-Za-z0-9_\-]{4,64}\}$/;

  /**
   * Submit flag for authoritative verification and atomic challenge completion
   */
  async submitFlag(params: SubmitFlagParams): Promise<CompletionResult> {
    const { participantId: resolvedParticipantId, teamId: resolvedTeamId } = await resolveEntities(
      params.participantId,
      params.teamId
    );
    const effectiveLookupId =
      resolvedParticipantId || resolvedTeamId || params.participantId || params.teamId || '';
    const { challengeId, sessionId, executionId } = params;
    const submittedFlag = (params.submittedFlag || '').trim();

    // 1. Authoritative Event State Gatekeeper
    const gatekeeper = await eventService.isCompetitionActionAllowed(effectiveLookupId);
    if (!gatekeeper.allowed) {
      return {
        success: false,
        accepted: false,
        code:
          gatekeeper.status === 'PAUSED'
            ? 'EVENT_PAUSED'
            : gatekeeper.status === 'ENDED'
            ? 'EVENT_ENDED'
            : gatekeeper.status === 'NOT_STARTED'
            ? 'EVENT_NOT_STARTED'
            : 'ACTION_DISALLOWED',
        message: gatekeeper.reason || 'Competition action not allowed in current state.',
      };
    }

    // 2. Challenge Existence and Active Status Check
    const challenge = await challengeRepository.getChallengeById(challengeId);
    if (!challenge) {
      return {
        success: false,
        accepted: false,
        code: 'CHALLENGE_NOT_FOUND',
        message: 'Challenge not found.',
      };
    }

    if (!challenge.isActive) {
      return {
        success: false,
        accepted: false,
        code: 'CHALLENGE_INACTIVE',
        message: 'This challenge is currently inactive.',
      };
    }

    // 3. Challenge Accessibility (Progression Check)
    const progression = await progressionService.getTeamProgression(effectiveLookupId);
    const targetChallenge = progression.challenges.find((c) => c.id === challengeId);
    const existingParticipantChallenge = await teamChallengeRepository.getParticipantChallenge(
      effectiveLookupId,
      challengeId
    );

    const isAlreadyCompleted = existingParticipantChallenge?.status === 'COMPLETED';
    if (isAlreadyCompleted) {
      return {
        success: false,
        accepted: false,
        alreadyCompleted: true,
        code: 'ALREADY_COMPLETED',
        message: 'You have already completed this challenge.',
      };
    }

    if (!targetChallenge || targetChallenge.status === 'LOCKED') {
      return {
        success: false,
        accepted: false,
        code: 'CHALLENGE_LOCKED',
        message: 'This challenge is locked. Complete preceding difficulties to unlock it.',
      };
    }

    // 4. Validate Flag Syntax Format (DBG{...})
    const submittedFlagHash = crypto
      .createHash('sha256')
      .update(submittedFlag)
      .digest('hex');

    if (!CompletionService.FLAG_PATTERN.test(submittedFlag)) {
      // Record invalid flag submission attempt
      await this.recordFlagAttempt({
        participantId: params.participantId,
        teamId: params.teamId,
        challengeId,
        sessionId,
        submissionId: executionId,
        submittedFlagHash,
        valid: false,
        flagRevealedInRun: false,
      });

      return {
        success: false,
        accepted: false,
        code: 'INVALID_FLAG_FORMAT',
        message: 'Invalid flag format. Flags must follow the DBG{...} format.',
      };
    }

    // 5. Authoritative Flag Verifier Check (Secure Constant-Time Comparison)
    const flagRow = await db
      .select()
      .from(challengeFlags)
      .where(eq(challengeFlags.challengeId, challengeId))
      .limit(1);

    if (!flagRow[0]) {
      return {
        success: false,
        accepted: false,
        code: 'FLAG_VERIFIER_MISSING',
        message: 'Server-side flag verifier not configured for this challenge.',
      };
    }

    const expectedVerifier = flagRow[0].flagVerifier;
    let isFlagHashMatch = false;

    try {
      const bufExpected = Buffer.from(expectedVerifier, 'hex');
      const bufActual = Buffer.from(submittedFlagHash, 'hex');
      if (bufExpected.length === bufActual.length) {
        isFlagHashMatch = crypto.timingSafeEqual(bufExpected, bufActual);
      }
    } catch {
      isFlagHashMatch = false;
    }

    if (!isFlagHashMatch) {
      // Record incorrect flag submission attempt
      await this.recordFlagAttempt({
        participantId: params.participantId,
        teamId: params.teamId,
        challengeId,
        sessionId,
        submissionId: executionId,
        submittedFlagHash,
        valid: false,
        flagRevealedInRun: false,
      });

      return {
        success: false,
        accepted: false,
        code: 'FLAG_REJECTED',
        message: 'FLAG REJECTED: Incorrect flag. Review your program output and try again.',
      };
    }

    // 6. Anti-Fake Flag & Validated Execution Verification
    // The participant must have a successful execution that passed behavioral validation
    let validExecutionId: string | undefined;

    if (executionId) {
      const exec = await teamChallengeRepository.getSubmissionById(
        executionId,
        resolvedParticipantId || resolvedTeamId || undefined
      );
      if (
        exec &&
        exec.challengeId === challengeId &&
        exec.executionStatus === 'SUCCESS' &&
        exec.behaviorStatus === 'PASS'
      ) {
        // Enforce execution ownership: must belong to the authenticated participant if participant is known
        const isOwner = !exec.participantId || !resolvedParticipantId || exec.participantId === resolvedParticipantId;
        if (isOwner) {
          // Confirm flag was revealed in this execution run
          const wasRevealed =
            exec.revealedFlag === submittedFlag ||
            (exec.stdout && exec.stdout.includes(submittedFlag));

          if (wasRevealed) {
            validExecutionId = exec.id;
          }
        }
      }
    } else {
      // Look up participant's latest successful validated execution for this challenge
      const latestExec = await teamChallengeRepository.getLatestValidatedExecution(
        resolvedParticipantId || resolvedTeamId || effectiveLookupId,
        challengeId
      );

      if (latestExec) {
        const isOwner = !latestExec.participantId || !resolvedParticipantId || latestExec.participantId === resolvedParticipantId;
        if (isOwner) {
          const wasRevealed =
            latestExec.revealedFlag === submittedFlag ||
            (latestExec.stdout && latestExec.stdout.includes(submittedFlag));

          if (wasRevealed) {
            validExecutionId = latestExec.id;
          }
        }
      }
    }

    if (!validExecutionId) {
      await this.recordFlagAttempt({
        participantId: params.participantId,
        teamId: params.teamId,
        challengeId,
        sessionId,
        submissionId: executionId,
        submittedFlagHash,
        valid: false,
        flagRevealedInRun: false,
      });

      return {
        success: false,
        accepted: false,
        code: 'UNVALIDATED_EXECUTION',
        message:
          'Flag submission requires a successful code execution run that passed all required behavioral tests.',
      };
    }

    // 7. Atomic Completion Transaction
    // Wraps the completion, solve count, points award, progression update, and audit log.
    const now = new Date();

    try {
      const completionResult = await db.transaction(async (tx) => {
        // Re-check current challenge state inside transaction for this participant / team
        if (resolvedParticipantId) {
          const currentPc = await tx
            .select()
            .from(participantChallenges)
            .where(
              and(
                eq(participantChallenges.participantId, resolvedParticipantId),
                eq(participantChallenges.challengeId, challengeId)
              )
            )
            .limit(1);

          if (currentPc[0] && currentPc[0].status === 'COMPLETED') {
            return {
              collided: true,
              message: 'THIS PROBLEM HAS ALREADY BEEN COMPLETED.',
            };
          }
        } else if (resolvedTeamId) {
          const currentTc = await tx
            .select()
            .from(teamChallenges)
            .where(
              and(
                eq(teamChallenges.teamId, resolvedTeamId),
                eq(teamChallenges.challengeId, challengeId)
              )
            )
            .limit(1);

          if (currentTc[0] && currentTc[0].status === 'COMPLETED') {
            return {
              collided: true,
              message: 'THIS PROBLEM HAS ALREADY BEEN COMPLETED.',
            };
          }
        }

        // Record successful flag submission
        await tx.insert(flagSubmissions).values({
          participantId: resolvedParticipantId,
          teamId: resolvedTeamId,
          challengeId,
          sessionId,
          submissionId: validExecutionId,
          submittedFlagHash,
          valid: true,
          flagRevealedInRun: true,
          createdAt: now,
        });

        // Mark participant_challenge as COMPLETED
        if (resolvedParticipantId) {
          try {
            await tx
              .insert(participantChallenges)
              .values({
                participantId: resolvedParticipantId,
                challengeId,
                status: 'COMPLETED',
                attemptCount: 1,
                startedAt: now,
                completedAt: now,
                completionTimestamp: now,
                completedBySessionId: sessionId,
                createdAt: now,
                updatedAt: now,
              })
              .onConflictDoUpdate({
                target: [participantChallenges.participantId, participantChallenges.challengeId],
                set: {
                  status: 'COMPLETED',
                  completedAt: now,
                  completionTimestamp: now,
                  completedBySessionId: sessionId,
                  updatedAt: now,
                },
              });
          } catch {}
        }

        // Mark team_challenge as COMPLETED for legacy compatibility
        if (resolvedTeamId) {
          try {
            await tx
              .insert(teamChallenges)
              .values({
                teamId: resolvedTeamId,
                challengeId,
                status: 'COMPLETED',
                attemptCount: 1,
                startedAt: now,
                completedAt: now,
                completionTimestamp: now,
                completedBySessionId: sessionId,
                createdAt: now,
                updatedAt: now,
              })
              .onConflictDoUpdate({
                target: [teamChallenges.teamId, teamChallenges.challengeId],
                set: {
                  status: 'COMPLETED',
                  completedAt: now,
                  completionTimestamp: now,
                  completedBySessionId: sessionId,
                  updatedAt: now,
                },
              });
          } catch {}
        }

        // Record administrative / audit log entry
        await tx.insert(auditLogs).values({
          action: 'CHALLENGE_COMPLETED',
          targetType: 'CHALLENGE',
          targetId: challengeId,
          reason: 'Valid flag submitted after behavioral verification.',
          metadata: {
            participantId: resolvedParticipantId,
            teamId: resolvedTeamId,
            sessionId,
            executionId: validExecutionId,
            pointsAwarded: challenge.score,
            completedAt: now.toISOString(),
          },
        });

        return { collided: false };
      });

      if (completionResult.collided) {
        return {
          success: false,
          accepted: false,
          alreadyCompleted: true,
          code: 'ALREADY_COMPLETED',
          message: completionResult.message,
        };
      }

      // 8. Re-evaluate progression & difficulty tier unlocks
      const updatedProgression = await progressionService.getTeamProgression(effectiveLookupId);
      const unlockedRounds = updatedProgression.rounds
        .filter((r) => r.isUnlocked)
        .map((r) => r.slug);

      const progressSummary = await teamChallengeRepository.getParticipantProgressSummary(
        effectiveLookupId
      );

      // 9. Realtime Participant Broadcast
      try {
        const broadcastTarget = resolvedParticipantId || resolvedTeamId || effectiveLookupId;
        teamRealtimeService.notifyTeamChallengeCompleted(broadcastTarget, {
          challengeId,
          challengeTitle: challenge.title,
          challengeSlug: challenge.slug,
          completedBySessionId: sessionId || 'unknown',
          pointsAwarded: challenge.score,
          problemsSolved: progressSummary.problemsSolved,
          totalScore: progressSummary.totalScore,
          unlockedRounds,
        });

        if (resolvedTeamId && resolvedTeamId !== broadcastTarget) {
          teamRealtimeService.notifyTeamChallengeCompleted(resolvedTeamId, {
            challengeId,
            challengeTitle: challenge.title,
            challengeSlug: challenge.slug,
            completedBySessionId: sessionId || 'unknown',
            pointsAwarded: challenge.score,
            problemsSolved: progressSummary.problemsSolved,
            totalScore: progressSummary.totalScore,
            unlockedRounds,
          });
        }

        teamRealtimeService.notifyTeamProgressUpdated(broadcastTarget, {
          problemsSolved: progressSummary.problemsSolved,
          totalScore: progressSummary.totalScore,
          unlockedRounds,
        });

        if (resolvedTeamId && resolvedTeamId !== broadcastTarget) {
          teamRealtimeService.notifyTeamProgressUpdated(resolvedTeamId, {
            problemsSolved: progressSummary.problemsSolved,
            totalScore: progressSummary.totalScore,
            unlockedRounds,
          });
        }

        if (unlockedRounds.length > 0) {
          teamRealtimeService.notifyTeamDifficultyUnlocked(broadcastTarget, {
            unlockedRounds,
          });
          if (resolvedTeamId && resolvedTeamId !== broadcastTarget) {
            teamRealtimeService.notifyTeamDifficultyUnlocked(resolvedTeamId, {
              unlockedRounds,
            });
          }
        }

        // 10. Public Realtime Broadcast (Live Leaderboard update)
        leaderboardRealtimeService.notifyLeaderboardUpdated();
      } catch (broadcastErr) {
        console.warn('[CompletionService] Background realtime broadcast warning:', broadcastErr);
      }

      return {
        success: true,
        accepted: true,
        code: 'FLAG_ACCEPTED',
        message: 'FLAG ACCEPTED! Problem solved and points awarded.',
        data: {
          challengeId,
          pointsAwarded: challenge.score,
          problemsSolved: progressSummary.problemsSolved,
          totalScore: progressSummary.totalScore,
          unlockedRounds,
        },
      };
    } catch (err: any) {
      console.error('[CompletionService] Transaction error during solve:', err);
      return {
        success: false,
        accepted: false,
        code: 'COMPLETION_ERROR',
        message: 'An internal error occurred while recording challenge completion.',
      };
    }
  }

  /**
   * Helper to record flag submission attempts in flag_submissions table
   */
  private async recordFlagAttempt(params: {
    participantId?: string;
    teamId?: string;
    challengeId: string;
    sessionId?: string;
    submissionId?: string;
    submittedFlagHash: string;
    valid: boolean;
    flagRevealedInRun: boolean;
  }) {
    try {
      const { participantId, teamId } = await resolveEntities(params.participantId, params.teamId);

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

      await db.insert(flagSubmissions).values({
        participantId,
        teamId,
        challengeId: params.challengeId,
        sessionId: params.sessionId,
        submissionId: params.submissionId,
        submittedFlagHash: params.submittedFlagHash,
        valid: params.valid,
        flagRevealedInRun: params.flagRevealedInRun,
        matchNumber,
        matchId,
      });
    } catch (err) {
      console.error('[CompletionService] Failed to record flag attempt:', err);
    }
  }
}

export const completionService = new CompletionService();

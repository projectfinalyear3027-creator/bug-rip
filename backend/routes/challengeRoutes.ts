/**
 * BUG RIP - Participant Challenge API Routes
 * Securely serves participant challenge queries, details, and execution requests.
 * Strictly forbids leaking hidden test cases, flag verifiers, or internal secrets.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { eq, and, or, desc } from 'drizzle-orm';
import { db } from '../../src/db/index.ts';
import { submissions } from '../../src/db/schema.ts';
import { progressionService } from '../services/progressionService.ts';
import { eventService } from '../services/eventService.ts';
import { challengeRepository } from '../repositories/challengeRepository.ts';
import { teamChallengeRepository } from '../repositories/teamChallengeRepository.ts';
import { requireParticipantAuth } from '../middleware/authMiddleware.ts';
import { executionQueue } from '../../execution-worker/queue.ts';
import { completionService } from '../services/completionService.ts';
import { assertNoForbiddenKeys } from '../rules/participantDataSecurity.ts';
import { executionRateLimiter, flagSubmissionRateLimiter } from '../middleware/rateLimiter.ts';

export const challengeRouter = Router();

/**
 * GET /api/challenges
 * Returns unlocked challenges and round progression for the authenticated participant
 */
challengeRouter.get(
  '/',
  requireParticipantAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const participantId = req.participant?.id || req.team!.id;
      const progress = await eventService.getTeamAvailableChallenges(participantId);
      return res.json({
        success: true,
        data: progress,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/challenges/:id
 * Returns safe challenge details and public test cases for the authenticated participant
 */
challengeRouter.get(
  '/:id',
  requireParticipantAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const eventStatus = await eventService.getEventStatus();
      if (eventStatus.status === 'NOT_STARTED') {
        return res.status(403).json({
          success: false,
          error: 'Challenges cannot be viewed before the competition has started.',
          code: 'EVENT_NOT_STARTED',
        });
      }

      const participantId = req.participant?.id || req.team!.id;
      const challengeId = req.params.id;

      const details = await progressionService.getParticipantChallengeDetails(
        participantId,
        challengeId
      );

      // Deep security invariant check: ensure no solution or admin secrets are leaked
      assertNoForbiddenKeys(details, 'challenge_details_api');

      return res.json({
        success: true,
        data: details,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Handler for Java source code execution request.
 * Derives participant identity strictly from authenticated session token (prevents participant spoofing).
 * Enforces competition action boundaries (RUNNING only).
 * Validates source size against challenge limits.
 * Prepares and queues execution request for isolated sandbox.
 */
export async function handleRunExecution(req: Request, res: Response, next: NextFunction) {
  try {
    const participantId = req.participant?.id || req.team!.id;
    const teamId = req.team!.id;
    const challengeId = req.params.id || req.body?.challengeId || req.body?.id;

    if (!challengeId) {
      return res.status(400).json({
        success: false,
        error: 'Challenge ID is required.',
        code: 'MISSING_CHALLENGE_ID',
      });
    }

    // 1. Authoritative Event State Gatekeeper
    const gatekeeper = await eventService.isCompetitionActionAllowed(participantId);
    if (!gatekeeper.allowed) {
      return res.status(403).json({
        success: false,
        error: gatekeeper.reason || 'Competition action not allowed in current state.',
        code:
          gatekeeper.status === 'PAUSED'
            ? 'EVENT_PAUSED'
            : gatekeeper.status === 'ENDED'
            ? 'EVENT_ENDED'
            : gatekeeper.status === 'NOT_STARTED'
            ? 'EVENT_NOT_STARTED'
            : 'ACTION_DISALLOWED',
      });
    }

    // 2. Challenge Existence and Active Status Check
    const challenge = await challengeRepository.getChallengeById(challengeId);
    if (!challenge) {
      return res.status(404).json({
        success: false,
        error: 'Challenge not found.',
        code: 'CHALLENGE_NOT_FOUND',
      });
    }

    if (!challenge.isActive) {
      return res.status(400).json({
        success: false,
        error: 'This challenge is currently inactive.',
        code: 'CHALLENGE_INACTIVE',
      });
    }

    // 3. Challenge Accessibility & Difficulty Unlocking Check
    const progression = await progressionService.getTeamProgression(participantId);
    const targetChallenge = progression.challenges.find((c) => c.id === challengeId);
    const partChal = await teamChallengeRepository.getParticipantChallenge(participantId, challengeId);
    const isCompleted = partChal?.status === 'COMPLETED';

    if (!isCompleted && (!targetChallenge || targetChallenge.status === 'LOCKED')) {
      return res.status(403).json({
        success: false,
        error: 'This challenge is locked. Complete the required difficulties to unlock it.',
        code: 'CHALLENGE_LOCKED',
      });
    }

    // 4. Source Code Validation
    const { sourceCode } = req.body || {};
    if (typeof sourceCode !== 'string' || sourceCode.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Source code cannot be empty.',
        code: 'EMPTY_SOURCE_CODE',
      });
    }

    // 5. Source Code Size Enforcement
    const maxSourceBytes = challenge.maxSourceBytes || 65536; // 64KB canonical limit
    const actualBytes = Buffer.byteLength(sourceCode, 'utf8');

    if (actualBytes > maxSourceBytes) {
      return res.status(400).json({
        success: false,
        error: `SOURCE CODE TOO LARGE: Submitted code (${actualBytes} bytes) exceeds maximum limit of ${maxSourceBytes} bytes.`,
        code: 'SOURCE_CODE_TOO_LARGE',
        maxSourceBytes,
        actualBytes,
      });
    }

    // 6. Record Execution Request in Submissions Table (Initial status QUEUED)
    const submission = await teamChallengeRepository.recordExecutionSubmission({
      participantId,
      teamId,
      challengeId: challenge.id,
      sessionId: req.sessionRecord?.id,
      sourceCode,
      executionStatus: 'QUEUED',
      stdout: null as any,
      stderr: null as any,
    });

    // 7. Enqueue Job for Fragment 8 Isolated Execution Worker
    await executionQueue.enqueue({
      jobId: submission.id,
      submissionId: submission.id,
      teamId,
      challengeId: challenge.id,
      submittedJavaSource: sourceCode,
      mainClassName: 'Main',
      timeoutSeconds: 3,
      submittedAt: submission.createdAt.toISOString(),
    });

    return res.json({
      success: true,
      data: {
        submissionId: submission.id,
        executionId: submission.id,
        challengeId: challenge.id,
        status: 'QUEUED',
        message: 'Code execution request enqueued for isolated sandbox.',
        submittedAt: submission.createdAt,
        attemptCount: (partChal?.attemptCount ?? 0) + 1,
      },
    });
  } catch (err) {
    next(err);
  }
}

challengeRouter.post(
  ['/:id/run', '/run'],
  requireParticipantAuth,
  handleRunExecution
);

/**
 * GET /api/challenges/:id/executions/:executionId
 * Fetches the live or terminal state of an execution for the authenticated participant.
 * Strictly verifies ownership against participant/team identity.
 */
challengeRouter.get(
  '/:id/executions/:executionId',
  requireParticipantAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const participantId = req.participant?.id || req.team!.id;
      const teamId = req.team!.id;
      const challengeId = req.params.id;
      const executionId = req.params.executionId;

      let sub = await teamChallengeRepository.getSubmissionById(executionId, participantId);
      if (!sub && teamId !== participantId) {
        sub = await teamChallengeRepository.getSubmissionById(executionId, teamId);
      }

      if (!sub || sub.challengeId !== challengeId) {
        return res.status(404).json({
          success: false,
          error: 'Execution not found or does not belong to you.',
          code: 'EXECUTION_NOT_FOUND',
        });
      }

      return res.json({
        success: true,
        data: {
          id: sub.id,
          submissionId: sub.id,
          executionId: sub.id,
          challengeId: sub.challengeId,
          status: sub.executionStatus,
          stdout: sub.stdout || '',
          stderr: sub.stderr || '',
          executionTimeMs: sub.executionTimeMs,
          memoryUsedBytes: sub.memoryUsedBytes,
          createdAt: sub.createdAt,
          startedAt: sub.startedAt,
          completedAt: sub.completedAt,
          behaviorStatus: sub.behaviorStatus,
          behaviorDiagnostics: sub.behaviorDiagnostics,
          revealedFlag: sub.revealedFlag,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/challenges/:id/submit-flag
 * Submits revealed CTF flag for authoritative verification and atomic challenge completion.
 */
challengeRouter.post(
  '/:id/submit-flag',
  requireParticipantAuth,
  flagSubmissionRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const participantId = req.participant?.id || req.team!.id;
      const teamId = req.team!.id;
      const challengeId = req.params.id;
      const { flag, executionId } = req.body || {};

      if (!flag || typeof flag !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Flag is required.',
          code: 'FLAG_REQUIRED',
        });
      }

      const result = await completionService.submitFlag({
        participantId,
        teamId,
        challengeId,
        submittedFlag: flag,
        sessionId: req.sessionRecord?.id,
        executionId,
      });

      if (!result.success) {
        const statusCode =
          result.code === 'ALREADY_COMPLETED' ||
          result.code === 'TEAMMATE_ALREADY_COMPLETED'
            ? 409
            : result.code === 'EVENT_PAUSED' ||
              result.code === 'EVENT_ENDED' ||
              result.code === 'EVENT_NOT_STARTED' ||
              result.code === 'CHALLENGE_LOCKED'
            ? 403
            : result.code === 'CHALLENGE_NOT_FOUND'
            ? 404
            : 400;

        return res.status(statusCode).json({
          success: false,
          error: result.message,
          code: result.code,
          alreadyCompleted: result.alreadyCompleted,
        });
      }

      return res.json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/challenges/:id/executions/:executionId/stream
 * Server-Sent Events (SSE) stream for real-time execution status updates.
 */
challengeRouter.get(
  '/:id/executions/:executionId/stream',
  requireParticipantAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const participantId = req.participant?.id || req.team!.id;
      const teamId = req.team!.id;
      const challengeId = req.params.id;
      const executionId = req.params.executionId;

      let sub = await teamChallengeRepository.getSubmissionById(executionId, participantId);
      if (!sub && teamId !== participantId) {
        sub = await teamChallengeRepository.getSubmissionById(executionId, teamId);
      }

      if (!sub || sub.challengeId !== challengeId) {
        return res.status(404).json({
          success: false,
          error: 'Execution not found or does not belong to you.',
          code: 'EXECUTION_NOT_FOUND',
        });
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      const sendEvent = (event: string, data: any) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      sendEvent('status', {
        status: sub.executionStatus,
        stdout: sub.stdout || '',
        stderr: sub.stderr || '',
        executionTimeMs: sub.executionTimeMs,
        behaviorStatus: sub.behaviorStatus,
        behaviorDiagnostics: sub.behaviorDiagnostics,
        revealedFlag: sub.revealedFlag,
      });

      if (sub.executionStatus !== 'QUEUED' && sub.executionStatus !== 'RUNNING') {
        res.end();
        return;
      }

      const onRunning = (data: any) => {
        if (data.submissionId === executionId) {
          sendEvent('status', { status: 'RUNNING' });
        }
      };

      const onCompleted = (data: any) => {
        if (data.submissionId === executionId) {
          sendEvent('completed', {
            status: data.result.status,
            stdout: data.result.stdout || '',
            stderr: data.result.stderr || '',
            executionTimeMs: data.result.durationMs,
            behaviorStatus: data.validation?.behaviorStatus,
            behaviorDiagnostics: data.validation ? {
              testsPassed: data.validation.testsPassed,
              flagRevealed: data.validation.flagRevealed,
              diagnosticMessage: data.validation.diagnosticMessage,
            } : undefined,
            revealedFlag: data.validation?.revealedFlag,
          });
          cleanup();
          res.end();
        }
      };

      const cleanup = () => {
        executionQueue.off('job:running', onRunning);
        executionQueue.off('job:completed', onCompleted);
      };

      executionQueue.on('job:running', onRunning);
      executionQueue.on('job:completed', onCompleted);

      req.on('close', cleanup);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/challenges/:id/submissions
 * Returns recent execution attempts for the authenticated participant on this challenge.
 * Strictly isolates submissions to req.participant.id.
 */
challengeRouter.get(
  '/:id/submissions',
  requireParticipantAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const participantId = req.participant?.id || req.team!.id;
      const challengeId = req.params.id;

      const participantSubs = await db
        .select({
          id: submissions.id,
          challengeId: submissions.challengeId,
          executionStatus: submissions.executionStatus,
          stdout: submissions.stdout,
          stderr: submissions.stderr,
          executionTimeMs: submissions.executionTimeMs,
          memoryUsedBytes: submissions.memoryUsedBytes,
          createdAt: submissions.createdAt,
        })
        .from(submissions)
        .where(
          and(
            or(
              eq(submissions.participantId, participantId),
              eq(submissions.teamId, participantId)
            ),
            eq(submissions.challengeId, challengeId)
          )
        )
        .orderBy(desc(submissions.createdAt))
        .limit(20);

      return res.json({
        success: true,
        data: participantSubs,
      });
    } catch (err) {
      next(err);
    }
  }
);


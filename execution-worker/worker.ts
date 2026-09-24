/**
 * BUG RIP - Dedicated Java Execution Worker Service (Fragment 8)
 * 
 * Consumes execution jobs from Redis/BullMQ (or in-memory queue),
 * isolates and executes Java submissions, updates database state,
 * and publishes completion events.
 */

import { executionQueue } from './queue';
import { IsolatedJavaSandbox } from './sandbox';
import { ExecutionJobPayload, ExecutionResult } from './types';
import { teamChallengeRepository } from '../backend/repositories/teamChallengeRepository';
import { challengeValidationService } from '../backend/services/challengeValidationService';
import { verifyExecutionEnvironmentOrThrow } from './jdkEnvironment';

export class ExecutionWorkerService {
  private workerId: string;
  private isRunning: boolean = false;

  constructor(workerId = `worker-${process.pid || 1}`) {
    this.workerId = workerId;
  }

  /**
   * Start the execution worker
   */
  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // Diagnostics: Verify OpenJDK 21 compiler and runtime environment
    verifyExecutionEnvironmentOrThrow();

    await executionQueue.initialize();

    // Register job processor
    executionQueue.registerWorkerHandler(async (payload: ExecutionJobPayload) => {
      return await this.processJob(payload);
    });

    console.log(`[ExecutionWorker] ${this.workerId} started in ${executionQueue.getMode()} mode.`);
  }

  /**
   * Process a single execution job through the sandbox pipeline
   */
  public async processJob(payload: ExecutionJobPayload): Promise<ExecutionResult> {
    const { submissionId, teamId, challengeId } = payload;
    const startTime = new Date();

    // 1. Transition database submission: QUEUED -> RUNNING
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(submissionId);
    if (isUuid) {
      try {
        await teamChallengeRepository.updateExecutionSubmission(submissionId, {
          executionStatus: 'RUNNING',
          startedAt: startTime,
          workerId: this.workerId,
        });
        executionQueue.emit('job:running', { submissionId, teamId, challengeId, workerId: this.workerId });
      } catch (dbErr) {
        console.error(`[ExecutionWorker] Failed to update submission ${submissionId} to RUNNING:`, dbErr);
      }
    } else {
      executionQueue.emit('job:running', { submissionId, teamId, challengeId, workerId: this.workerId });
    }

    // 2. Execute within Isolated Java Sandbox
    let result: ExecutionResult;
    try {
      result = await IsolatedJavaSandbox.execute(payload, {
        workerId: this.workerId,
        timeoutMs: payload.timeoutSeconds ? payload.timeoutSeconds * 1000 : undefined,
        maxOutputBytes: payload.maxOutputBytes,
        stdin: payload.stdin,
      });
    } catch (sandboxErr: any) {
      result = {
        jobId: payload.jobId,
        submissionId,
        status: 'SANDBOX_ERROR',
        exitCode: 1,
        stdout: '',
        stderr: `Sandbox execution error: ${sandboxErr?.message || 'Unknown sandbox failure'}`,
        durationMs: Date.now() - startTime.getTime(),
        workerId: this.workerId,
      };
    }

    // 3. Behavioral Validation (Fragment 9: Hidden Flag Reveal & Test Validation)
    let validationResult;
    try {
      validationResult = await challengeValidationService.validateExecution(challengeId, result);
    } catch (valErr) {
      console.error(`[ExecutionWorker] Behavioral validation failed for ${submissionId}:`, valErr);
      validationResult = {
        behaviorStatus: 'FAIL' as const,
        testsPassed: false,
        flagRevealed: false,
        diagnosticMessage: 'Behavioral validation encountered an internal error.',
      };
    }

    // 4. Update database submission with terminal execution state & behavioral diagnostics
    const completedAt = new Date();
    if (isUuid) {
      try {
        await teamChallengeRepository.updateExecutionSubmission(submissionId, {
          executionStatus: result.status,
          stdout: result.stdout,
          stderr: result.stderr,
          executionTimeMs: result.durationMs,
          completedAt,
          workerId: this.workerId,
          behaviorStatus: validationResult.behaviorStatus,
          behaviorDiagnostics: {
            testsPassed: validationResult.testsPassed,
            flagRevealed: validationResult.flagRevealed,
            diagnosticMessage: validationResult.diagnosticMessage,
          },
          revealedFlag: validationResult.revealedFlag || null,
        });
      } catch (dbErr) {
        console.error(`[ExecutionWorker] Failed to record completed submission ${submissionId}:`, dbErr);
      }
    }

    // 5. Emit completed event for real-time listeners (SSE / WebSockets)
    executionQueue.emit('job:completed', {
      submissionId,
      teamId,
      challengeId,
      result,
      validation: validationResult,
    });

    return result;
  }

  /**
   * Stop worker gracefully
   */
  public async stop(): Promise<void> {
    this.isRunning = false;
    await executionQueue.close();
    console.log(`[ExecutionWorker] ${this.workerId} stopped.`);
  }
}

export const executionWorker = new ExecutionWorkerService();

// Support standalone process launch: `tsx execution-worker/worker.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  executionWorker.start().catch((err) => {
    console.error('[ExecutionWorker] Failed to start:', err);
    process.exit(1);
  });
}

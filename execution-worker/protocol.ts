/**
 * BUG RIP - Execution Worker Queue Protocol
 * Defines contract between Backend API and Worker instances via Redis/BullMQ.
 */

import { ExecutionJobPayload, ExecutionResult } from './types';

// Canonical BullMQ runtime execution queue name
export const EXECUTION_QUEUE_NAME = 'java-execution';

// DEPRECATED / LEGACY queue constant (isolated for historical backward compatibility)
export const LEGACY_EXECUTION_QUEUE_NAME = 'bugrip-java-execution-queue';

export interface WorkerJobEvents {
  onJobReceived: (jobId: string) => void;
  onJobCompiling: (jobId: string) => void;
  onJobRunning: (jobId: string) => void;
  onJobComplete: (result: ExecutionResult) => void;
  onJobFailed: (jobId: string, error: string) => void;
}

export interface ExecutionJobMessage {
  type: 'EXECUTE_JAVA_CHALLENGE';
  payload: ExecutionJobPayload;
}

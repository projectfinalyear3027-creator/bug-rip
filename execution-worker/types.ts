/**
 * BUG RIP - Execution Worker & Sandbox Types
 * Defines data structures for untrusted Java compilation, execution, and verification.
 */

export type SubmissionExecutionStatus =
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

export interface ExecutionJobPayload {
  jobId: string;
  submissionId: string;
  teamId: string;
  participantId?: string;
  challengeId: string;
  submittedJavaSource: string;
  mainClassName?: string;
  timeoutSeconds?: number;
  memoryLimitMb?: number;
  maxOutputBytes?: number;
  stdin?: string;
  submittedAt: string;
  correlationId?: string;
}

export interface ExecutionResult {
  jobId: string;
  submissionId: string;
  status: SubmissionExecutionStatus;
  exitCode: number;
  stdout: string;
  stderr: string;
  compilationOutput?: string;
  durationMs: number;
  memoryUsedBytes?: number;
  workerId?: string;
  revealedFlagCandidate?: string;
  isFlagValid?: boolean;
}

export interface SandboxResourceLimits {
  timeoutSeconds: number;       // default 3-5 seconds
  memoryLimitBytes: number;     // default 256MB
  cpuShares?: number;           // cpu shares / 1 core
  maxProcessCount?: number;     // pids.max = 32
  maxOutputBytes: number;       // 64KB (65536 bytes)
  networkAccess: boolean;       // false (strictly isolated)
  readOnlyRootFs?: boolean;     // true
}

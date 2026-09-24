/**
 * BUG RIP - Backend Request Validation Schemas (Zod)
 * Validates request bodies, parameters, query arguments, and enums safely.
 */

import { z } from 'zod';

export const teamLoginSchema = z.object({
  teamName: z
    .string()
    .trim()
    .min(2, 'Team name must be at least 2 characters')
    .max(120, 'Team name cannot exceed 120 characters'),
  teamCode: z
    .string()
    .trim()
    .min(3, 'Team code must be at least 3 characters')
    .max(64, 'Team code cannot exceed 64 characters'),
});

export const sessionHeartbeatSchema = z.object({
  sessionToken: z.string().min(16, 'Invalid session token format'),
});

export const javaExecutionSchema = z.object({
  teamId: z.string().uuid('Invalid team ID format'),
  challengeId: z.string().min(3).max(64),
  sessionId: z.string().uuid().optional(),
  sourceCode: z
    .string()
    .min(1, 'Source code cannot be empty')
    .max(32768, 'Source code exceeds maximum size limit (32KB)'),
});

export const flagSubmissionSchema = z.object({
  teamId: z.string().uuid('Invalid team ID format'),
  challengeId: z.string().min(3).max(64),
  sessionId: z.string().uuid().optional(),
  flag: z
    .string()
    .trim()
    .min(4, 'Flag cannot be empty')
    .max(128, 'Flag exceeds maximum length'),
});

export const eventStatusUpdateSchema = z.object({
  status: z.enum(['NOT_STARTED', 'RUNNING', 'PAUSED', 'ENDED']),
  durationMinutes: z.number().int().min(5).max(300).optional(),
});

export const auditLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type TeamLoginInput = z.infer<typeof teamLoginSchema>;
export type JavaExecutionInput = z.infer<typeof javaExecutionSchema>;
export type FlagSubmissionInput = z.infer<typeof flagSubmissionSchema>;
export type EventStatusUpdateInput = z.infer<typeof eventStatusUpdateSchema>;

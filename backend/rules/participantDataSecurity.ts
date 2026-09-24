/**
 * BUG RIP - Participant Data Security & Anti-Leak Shield
 * Enforces strict boundary between organizer/admin data and participant data.
 * 
 * IMMUTABLE SECURITY INVARIANT:
 * Participants must NEVER receive:
 * - solution Java / reference solutions
 * - hidden test cases / hidden inputs/outputs
 * - authoritative flag / flag hash / verifier
 * - internal admin notes / defect solutions
 * 
 * This module provides both projection mappers and recursive assertion guards
 * to prevent accidental field exposure in participant APIs.
 */

import { ParticipantChallengeDTO, ParticipantTestCaseDTO } from '../types/competition.ts';

export const PROHIBITED_PARTICIPANT_KEYS = new Set([
  'solution',
  'solutioncode',
  'solution_code',
  'referencesolution',
  'reference_solution',
  'expectedcode',
  'expected_code',
  'correctcode',
  'correct_code',
  'hiddentests',
  'hidden_tests',
  'hiddentestcases',
  'hidden_test_cases',
  'flag',
  'flaghash',
  'flag_hash',
  'flagverifier',
  'flag_verifier',
  'verifier',
  'adminnotes',
  'admin_notes',
  'answer',
  'answerexplanation',
]);

/**
 * Recursively asserts that no prohibited keys exist in a response payload.
 * Throws a SecurityLeakError if any prohibited key is detected.
 */
export function assertNoForbiddenKeys(obj: any, path: string = 'root'): void {
  if (obj === null || obj === undefined) return;

  if (Array.isArray(obj)) {
    obj.forEach((item, idx) => assertNoForbiddenKeys(item, `${path}[${idx}]`));
    return;
  }

  if (typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (PROHIBITED_PARTICIPANT_KEYS.has(normalizedKey)) {
        throw new Error(
          `CRITICAL ARENA SECURITY VIOLATION: Prohibited key "${key}" detected in participant response at path "${path}.${key}"!`
        );
      }
      assertNoForbiddenKeys(obj[key], `${path}.${key}`);
    }
  }
}

/**
 * Explicitly projects raw database or service data into a strictly typed ParticipantChallengeDTO.
 * Guaranteed to omit all forbidden solution, verifier, and admin fields.
 */
export function toParticipantChallengeDTO(raw: {
  id: string;
  roundId: string;
  title: string;
  slug: string;
  description: string;
  starterCode: string;
  score: number;
  displayOrder?: number;
  validationType?: string;
  timeLimitMs?: number;
  memoryLimitMb?: number;
  maxOutputBytes?: number;
  maxSourceBytes?: number;
  status?: string;
  attemptCount?: number;
  publicTestCases?: Array<{
    id: string;
    inputData: string;
    expectedOutput: string;
    testType?: string;
    displayOrder?: number;
    explanation?: string | null;
    isHidden?: boolean;
  }>;
}): ParticipantChallengeDTO {
  const safePublicCases: ParticipantTestCaseDTO[] = (raw.publicTestCases || [])
    .filter((tc) => !tc.isHidden)
    .map((tc) => ({
      id: tc.id,
      inputData: tc.inputData,
      expectedOutput: tc.expectedOutput,
      testType: tc.testType ?? 'PUBLIC',
      displayOrder: tc.displayOrder,
      explanation: tc.explanation ?? null,
    }));

  const dto: ParticipantChallengeDTO = {
    id: raw.id,
    roundId: raw.roundId,
    title: raw.title,
    slug: raw.slug,
    description: raw.description,
    starterCode: raw.starterCode, // The buggy Java code the participant must debug
    score: raw.score,
    displayOrder: raw.displayOrder ?? 0,
    validationType: raw.validationType ?? 'EXACT_OUTPUT',
    timeLimitMs: raw.timeLimitMs ?? 3000,
    memoryLimitMb: raw.memoryLimitMb ?? 256,
    maxOutputBytes: raw.maxOutputBytes ?? 65536,
    maxSourceBytes: raw.maxSourceBytes ?? 32768,
    status: (raw.status as any) ?? 'AVAILABLE',
    attemptCount: raw.attemptCount ?? 0,
    publicTestCases: safePublicCases,
  };

  // Run security assertion before releasing
  assertNoForbiddenKeys(dto, 'ParticipantChallengeDTO');

  return dto;
}

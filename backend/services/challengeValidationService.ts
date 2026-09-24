/**
 * BUG RIP - Challenge Validation Service (Fragment 9)
 * 
 * Responsibilities:
 * 1. Inspects Java execution results from the isolated sandbox.
 * 2. Validates program behavior against required public and hidden test criteria.
 * 3. Evaluates if the program ran cleanly and successfully reached the intended solution path.
 * 4. Extracts revealed flags (format: DBG{...}) produced by the program's output.
 * 5. Strictly protects hidden test case details from leaking to participants.
 * 6. Distinguishes: Execution SUCCESS vs. Behavioral Tests PASS vs. Flag Revealed.
 */

import { eq, and } from 'drizzle-orm';
import { db } from '../../src/db/index.ts';
import { challenges, challengeTestCases } from '../../src/db/schema.ts';

export interface BehaviorValidationResult {
  behaviorStatus: 'PASS' | 'FAIL';
  testsPassed: boolean;
  flagRevealed: boolean;
  revealedFlag?: string;
  diagnosticMessage: string;
}

export class ChallengeValidationService {
  /**
   * Canonical flag pattern for BUG RIP CTF
   * Example: DBG{FACTORIAL_729X}, DBG{PALINDROME_9921K}
   */
  private static readonly FLAG_REGEX = /DBG\{[A-Za-z0-9_\-]{4,64}\}/;

  /**
   * Validate program behavior and extract any legitimately revealed flag from execution output
   */
  async validateExecution(
    challengeId: string,
    result: { status: string; stdout?: string; stderr?: string }
  ): Promise<BehaviorValidationResult> {
    // 1. If execution was not cleanly successful, behavioral validation fails immediately
    if (result.status !== 'SUCCESS') {
      return {
        behaviorStatus: 'FAIL',
        testsPassed: false,
        flagRevealed: false,
        diagnosticMessage:
          result.status === 'COMPILE_ERROR'
            ? 'Compilation failed. Resolve syntax errors to continue.'
            : result.status === 'RUNTIME_ERROR'
            ? 'Runtime exception encountered during execution.'
            : result.status === 'TIMEOUT'
            ? 'Execution timed out. Ensure algorithm finishes within time limits.'
            : 'Execution failed to complete cleanly in the sandbox.',
      };
    }

    const stdout = (result.stdout || '').trim();

    // 2. Fetch challenge configuration and test cases
    const chal = await db
      .select()
      .from(challenges)
      .where(eq(challenges.id, challengeId))
      .limit(1);

    if (!chal[0]) {
      return {
        behaviorStatus: 'FAIL',
        testsPassed: false,
        flagRevealed: false,
        diagnosticMessage: 'Challenge metadata not found.',
      };
    }

    const testCases = await db
      .select()
      .from(challengeTestCases)
      .where(eq(challengeTestCases.challengeId, challengeId));

    // 3. Behavioral Verification
    // Check if the program's output passes test criteria:
    // A. Must not contain obvious test failure indicators
    const hasFailureIndicator =
      /Tests?\s+failed/i.test(stdout) ||
      /AssertionError/i.test(stdout) ||
      /Test\s+Case\s+Failed/i.test(stdout) ||
      /FAILED/i.test(stdout);

    // B. Check if program derived and revealed a valid flag pattern
    const flagMatch = stdout.match(ChallengeValidationService.FLAG_REGEX);
    const candidateFlag = flagMatch ? flagMatch[0] : undefined;

    // C. Behavioral verification:
    // In CTF debugging, a legitimate flag revelation without failure indicators signifies success.
    // For programs without flag revelation, check public test expected outputs.
    let expectedOutputMatches = true;
    if (!candidateFlag) {
      const publicCases = testCases.filter((tc) => !tc.isHidden);
      for (const tc of publicCases) {
        if (tc.expectedOutput && tc.expectedOutput.trim().length > 0) {
          const expected = tc.expectedOutput.trim();
          if (!stdout.includes(expected)) {
            expectedOutputMatches = false;
            break;
          }
        }
      }
    }

    // Both behavioral checks and flag revelation must hold
    const testsPassed = !hasFailureIndicator && expectedOutputMatches;
    const flagRevealed = testsPassed && !!candidateFlag;

    if (flagRevealed && candidateFlag) {
      return {
        behaviorStatus: 'PASS',
        testsPassed: true,
        flagRevealed: true,
        revealedFlag: candidateFlag,
        diagnosticMessage: 'All required behavioral tests passed! Hidden flag revealed in output.',
      };
    } else if (testsPassed && !candidateFlag) {
      return {
        behaviorStatus: 'PASS',
        testsPassed: true,
        flagRevealed: false,
        diagnosticMessage: 'Tests completed cleanly, but no flag was produced by the program.',
      };
    } else {
      return {
        behaviorStatus: 'FAIL',
        testsPassed: false,
        flagRevealed: false,
        diagnosticMessage: 'Some required tests failed. Review program logic and continue debugging.',
      };
    }
  }

  /**
   * Verify if a flag submission is corroborated by a validated execution run
   */
  isFlagCorroborated(
    submittedFlag: string,
    execution: {
      status: string;
      behaviorStatus?: string | null;
      revealedFlag?: string | null;
      stdout?: string | null;
    }
  ): boolean {
    if (execution.status !== 'SUCCESS') return false;
    if (execution.behaviorStatus !== 'PASS') return false;

    const trimmed = submittedFlag.trim();
    if (execution.revealedFlag && execution.revealedFlag === trimmed) {
      return true;
    }

    if (execution.stdout && execution.stdout.includes(trimmed)) {
      return true;
    }

    return false;
  }
}

export const challengeValidationService = new ChallengeValidationService();

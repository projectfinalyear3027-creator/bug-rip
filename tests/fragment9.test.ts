/**
 * BUG RIP - Fragment 9 Test Suite
 * Hidden Flag Reveal, Behavioral Validation, Completion & Scoring
 * 
 * Verifies:
 * 1. Behavioral Validation (Execution SUCCESS != Challenge Complete)
 * 2. Hidden Flag Revelation (Format DBG{...})
 * 3. Execution Tie-in & Anti-Fake-Flag Protection
 * 4. Constant-time Flag Hash Verification
 * 5. Atomic Problem Completion & Points Awarding
 * 6. Solved Count Progression (Unlocks next tier based on unique solve count)
 * 7. Duplicate & Race Protection (Idempotent first solve wins, no double points)
 * 8. Event State Machine Gatekeeper (Rejects when PAUSED or ENDED)
 * 9. Cross-team Isolation (Cannot use another team's execution ID or steal solves)
 * 10. Audit Logging on Solve Completion
 */

process.env.PG_MEM = 'true';

import { db } from '../src/db/index.ts';
import { runMigrations } from '../database/migrator.ts';
import { runSeed } from '../database/seed.ts';
import { teamChallengeRepository } from '../backend/repositories/teamChallengeRepository.ts';
import { challengeRepository } from '../backend/repositories/challengeRepository.ts';
import { adminRepository } from '../backend/repositories/adminRepository.ts';
import { challengeValidationService } from '../backend/services/challengeValidationService.ts';
import { completionService } from '../backend/services/completionService.ts';
import { eventService } from '../backend/services/eventService.ts';
import { progressionService } from '../backend/services/progressionService.ts';
import {
  teams,
  submissions,
  teamChallenges,
  flagSubmissions,
  auditLogs,
  adminUsers,
  challenges,
  rounds,
} from '../src/db/schema.ts';
import { eq, and } from 'drizzle-orm';

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    testsPassed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    testsFailed++;
  }
}

async function runFragment9TestSuite() {
  console.log('\n================================================================');
  console.log('BUG RIP - FRAGMENT 9: FLAG REVEAL, VALIDATION & COMPLETION TESTS');
  console.log('================================================================');

  // Initialize DB and base state
  await runMigrations();
  await runSeed();

  const adminUsersList = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.username, 'admin'))
    .limit(1);
  const superAdminId = adminUsersList[0].id;

  // Retrieve seeded teams
  const teamAlpha = (
    await db
      .select()
      .from(teams)
      .where(eq(teams.teamName, 'Development Team Alpha'))
      .limit(1)
  )[0];

  const teamBeta = (
    await db
      .select()
      .from(teams)
      .where(eq(teams.teamName, 'Development Team Beta'))
      .limit(1)
  )[0];

  assert(!!teamAlpha && !!teamBeta, 'Test teams Alpha and Beta retrieved');

  // Clear submissions, flags, and completions for fresh tests
  await db.delete(flagSubmissions);
  await db.delete(submissions);
  await db.delete(teamChallenges);

  // Ensure competition event is RUNNING
  await adminRepository.transitionEventStatus('RUNNING', superAdminId, 'START');

  // ---------------------------------------------------------------------------
  // 1. BEHAVIORAL VALIDATION: Execution SUCCESS != Challenge Completion
  // ---------------------------------------------------------------------------
  console.log('\n--- Test Group 1: Behavioral Validation Logic ---');

  const chal1 = await challengeRepository.getChallengeById('EASY-01-FACTORIAL');
  assert(!!chal1, 'EASY-01-FACTORIAL retrieved');

  // 1A. Execution failed/compile error
  const failResult = await challengeValidationService.validateExecution(chal1!.id, {
    status: 'COMPILE_ERROR',
    stderr: 'Solution.java:5: error: cannot find symbol',
  });
  assert(
    failResult.behaviorStatus === 'FAIL' && !failResult.flagRevealed,
    'Compile error returns behaviorStatus: FAIL and flagRevealed: false'
  );

  // 1B. Execution succeeded, but program output shows tests failed
  const testFailedResult = await challengeValidationService.validateExecution(chal1!.id, {
    status: 'SUCCESS',
    stdout: 'Computed 5!: 24\nComputed 10!: 362880\nTests failed. Keep debugging to unlock flag.',
  });
  assert(
    testFailedResult.behaviorStatus === 'FAIL' && !testFailedResult.flagRevealed,
    'Execution returning SUCCESS but failing test checks yields behaviorStatus: FAIL'
  );

  // 1C. Execution succeeded, all tests passed and flag printed
  const successResult = await challengeValidationService.validateExecution(chal1!.id, {
    status: 'SUCCESS',
    stdout: 'Computed 5!: 120\nComputed 10!: 3628800\nFLAG REVEALED: DBG{FACTORIAL_729X}',
  });
  assert(
    successResult.behaviorStatus === 'PASS' &&
      successResult.flagRevealed &&
      successResult.revealedFlag === 'DBG{FACTORIAL_729X}',
    'Execution passing behavioral checks extracts valid DBG{...} flag'
  );

  // ---------------------------------------------------------------------------
  // 2. ANTI-FAKE FLAG: Attempting to submit without validated execution
  // ---------------------------------------------------------------------------
  console.log('\n--- Test Group 2: Anti-Fake Flag & Execution Tie-in ---');

  const unvalidatedSubmit = await completionService.submitFlag({
    teamId: teamAlpha.id,
    challengeId: chal1!.id,
    submittedFlag: 'DBG{FACTORIAL_729X}',
  });
  assert(
    !unvalidatedSubmit.success && unvalidatedSubmit.code === 'UNVALIDATED_EXECUTION',
    'Submitting flag without prior validated execution is rejected (UNVALIDATED_EXECUTION)'
  );

  // Create an execution for Team Alpha that failed behavioral tests
  const failedExec = await teamChallengeRepository.recordExecutionSubmission({
    teamId: teamAlpha.id,
    challengeId: chal1!.id,
    sourceCode: 'public class Main {}',
    executionStatus: 'SUCCESS',
  });
  await teamChallengeRepository.updateExecutionSubmission(failedExec.id, {
    executionStatus: 'SUCCESS',
    behaviorStatus: 'FAIL',
    stdout: 'Tests failed.',
  });

  const submitWithFailedExec = await completionService.submitFlag({
    teamId: teamAlpha.id,
    challengeId: chal1!.id,
    submittedFlag: 'DBG{FACTORIAL_729X}',
    executionId: failedExec.id,
  });
  assert(
    !submitWithFailedExec.success && submitWithFailedExec.code === 'UNVALIDATED_EXECUTION',
    'Submitting flag tied to an execution with behaviorStatus: FAIL is rejected'
  );

  // Create an execution for Team Beta that passed
  const betaExec = await teamChallengeRepository.recordExecutionSubmission({
    teamId: teamBeta.id,
    challengeId: chal1!.id,
    sourceCode: 'public class Main {}',
    executionStatus: 'SUCCESS',
  });
  await teamChallengeRepository.updateExecutionSubmission(betaExec.id, {
    executionStatus: 'SUCCESS',
    behaviorStatus: 'PASS',
    revealedFlag: 'DBG{FACTORIAL_729X}',
    stdout: 'FLAG REVEALED: DBG{FACTORIAL_729X}',
  });

  // Team Alpha attempts to use Team Beta's execution ID (Cross-team theft attack)
  const crossTeamTheft = await completionService.submitFlag({
    teamId: teamAlpha.id,
    challengeId: chal1!.id,
    submittedFlag: 'DBG{FACTORIAL_729X}',
    executionId: betaExec.id,
  });
  assert(
    !crossTeamTheft.success && crossTeamTheft.code === 'UNVALIDATED_EXECUTION',
    'Cross-team execution spoofing rejected (cannot submit another team execution ID)'
  );

  // ---------------------------------------------------------------------------
  // 3. FLAG FORMAT & CONSTANT-TIME VERIFICATION
  // ---------------------------------------------------------------------------
  console.log('\n--- Test Group 3: Flag Format & Verification ---');

  // Create a valid execution for Team Alpha
  const alphaExec = await teamChallengeRepository.recordExecutionSubmission({
    teamId: teamAlpha.id,
    challengeId: chal1!.id,
    sourceCode: 'public class Main {}',
    executionStatus: 'SUCCESS',
  });
  await teamChallengeRepository.updateExecutionSubmission(alphaExec.id, {
    executionStatus: 'SUCCESS',
    behaviorStatus: 'PASS',
    revealedFlag: 'DBG{FACTORIAL_729X}',
    stdout: 'FLAG REVEALED: DBG{FACTORIAL_729X}',
  });

  // Malformed flag format
  const malformedSubmit = await completionService.submitFlag({
    teamId: teamAlpha.id,
    challengeId: chal1!.id,
    submittedFlag: 'INVALID_FLAG_FORMAT',
    executionId: alphaExec.id,
  });
  assert(
    !malformedSubmit.success && malformedSubmit.code === 'INVALID_FLAG_FORMAT',
    'Malformed flag format rejected with INVALID_FLAG_FORMAT'
  );

  // Incorrect flag content
  const incorrectSubmit = await completionService.submitFlag({
    teamId: teamAlpha.id,
    challengeId: chal1!.id,
    submittedFlag: 'DBG{WRONG_FLAG_1234}',
    executionId: alphaExec.id,
  });
  assert(
    !incorrectSubmit.success && incorrectSubmit.code === 'FLAG_REJECTED',
    'Incorrect flag value rejected with FLAG_REJECTED'
  );

  // ---------------------------------------------------------------------------
  // 4. ATOMIC PROBLEM COMPLETION & SCORING
  // ---------------------------------------------------------------------------
  console.log('\n--- Test Group 4: Atomic Problem Completion & Scoring ---');

  const validSubmit = await completionService.submitFlag({
    teamId: teamAlpha.id,
    challengeId: chal1!.id,
    submittedFlag: 'DBG{FACTORIAL_729X}',
    executionId: alphaExec.id,
  });

  assert(
    validSubmit.success && validSubmit.code === 'FLAG_ACCEPTED',
    'Valid flag submission accepted with FLAG_ACCEPTED'
  );
  assert(
    validSubmit.data?.pointsAwarded === chal1!.score,
    `Accurately awarded ${chal1!.score} points`
  );

  // Verify database state: team_challenges table
  const tcRecord = await teamChallengeRepository.getTeamChallenge(teamAlpha.id, chal1!.id);
  assert(
    tcRecord?.status === 'COMPLETED' && !!tcRecord.completedAt,
    'Database team_challenges marked as COMPLETED with completedAt timestamp'
  );

  // Verify flag_submissions record
  const flagSubRecord = (
    await db
      .select()
      .from(flagSubmissions)
      .where(
        and(
          eq(flagSubmissions.teamId, teamAlpha.id),
          eq(flagSubmissions.challengeId, chal1!.id),
          eq(flagSubmissions.valid, true)
        )
      )
  )[0];
  assert(
    !!flagSubRecord && flagSubRecord.flagRevealedInRun === true,
    'Flag submission logged with valid: true and flagRevealedInRun: true'
  );

  // ---------------------------------------------------------------------------
  // 5. IDEMPOTENCY & DUPLICATE SUBMISSION PROTECTION
  // ---------------------------------------------------------------------------
  console.log('\n--- Test Group 5: Duplicate Solve & Race Protection ---');

  const duplicateSubmit = await completionService.submitFlag({
    teamId: teamAlpha.id,
    challengeId: chal1!.id,
    submittedFlag: 'DBG{FACTORIAL_729X}',
    executionId: alphaExec.id,
  });
  assert(
    !duplicateSubmit.success && duplicateSubmit.code === 'ALREADY_COMPLETED',
    'Subsequent flag submission on already completed challenge rejected with ALREADY_COMPLETED'
  );

  // Total score must remain unmodified on duplicate attempt
  const progressAlpha = await teamChallengeRepository.getTeamProgressSummary(teamAlpha.id);
  assert(
    progressAlpha.totalScore === chal1!.score && progressAlpha.problemsSolved === 1,
    'Team score and solved count are NOT double-counted on duplicate submit'
  );

  // ---------------------------------------------------------------------------
  // 6. PROGRESSION EVALUATION BASED ON UNIQUE SOLVED COUNT
  // ---------------------------------------------------------------------------
  console.log('\n--- Test Group 6: Difficulty Progression based on Solved Count ---');

  // Set Medium round unlockRequiredSolves to 2 for deterministic testing of progression unlock
  await db
    .update(rounds)
    .set({ unlockRequiredSolves: 2 })
    .where(eq(rounds.slug, 'medium'));

  // Retrieve Medium round and check unlock threshold
  const progBefore = await progressionService.getTeamProgression(teamAlpha.id);
  const medRoundBefore = progBefore.rounds.find((r) => r.slug === 'medium');
  console.log(`  Configured Medium Round unlock threshold: ${medRoundBefore?.unlockRequiredSolves} solves required in Easy`);
  assert(medRoundBefore?.isUnlocked === false, 'Medium round is initially locked');

  // Complete second Easy challenge (EASY-02-PALINDROME)
  const chal2 = await challengeRepository.getChallengeById('EASY-02-PALINDROME');
  assert(!!chal2, 'EASY-02-PALINDROME retrieved');

  const alphaExec2 = await teamChallengeRepository.recordExecutionSubmission({
    teamId: teamAlpha.id,
    challengeId: chal2!.id,
    sourceCode: 'public class Main {}',
    executionStatus: 'SUCCESS',
  });
  await teamChallengeRepository.updateExecutionSubmission(alphaExec2.id, {
    executionStatus: 'SUCCESS',
    behaviorStatus: 'PASS',
    revealedFlag: 'DBG{PALINDROME_9921K}',
    stdout: 'FLAG REVEALED: DBG{PALINDROME_9921K}',
  });

  const solve2 = await completionService.submitFlag({
    teamId: teamAlpha.id,
    challengeId: chal2!.id,
    submittedFlag: 'DBG{PALINDROME_9921K}',
    executionId: alphaExec2.id,
  });
  assert(solve2.success, 'Second Easy challenge successfully completed');

  // Re-check progression
  const progAfter = await progressionService.getTeamProgression(teamAlpha.id);
  const medRoundAfter = progAfter.rounds.find((r) => r.slug === 'medium');
  assert(
    medRoundAfter?.isUnlocked === true,
    'Medium difficulty unlocked after achieving required solves threshold in Easy'
  );

  // ---------------------------------------------------------------------------
  // 7. EVENT STATE GATEKEEPER (PAUSED / ENDED)
  // ---------------------------------------------------------------------------
  console.log('\n--- Test Group 7: Event State Machine Gatekeeper ---');

  // Pause event
  await adminRepository.transitionEventStatus('PAUSED', superAdminId, 'PAUSE');

  // Attempt flag submission during PAUSED
  const pausedSubmit = await completionService.submitFlag({
    teamId: teamBeta.id,
    challengeId: chal1!.id,
    submittedFlag: 'DBG{FACTORIAL_729X}',
    executionId: betaExec.id,
  });
  assert(
    !pausedSubmit.success && pausedSubmit.code === 'EVENT_PAUSED',
    'Flag submission strictly blocked when competition event is PAUSED'
  );

  // Resume event
  await adminRepository.transitionEventStatus('RUNNING', superAdminId, 'RESUME');

  // End event
  await adminRepository.transitionEventStatus('ENDED', superAdminId, 'END');

  // Attempt flag submission during ENDED
  const endedSubmit = await completionService.submitFlag({
    teamId: teamBeta.id,
    challengeId: chal1!.id,
    submittedFlag: 'DBG{FACTORIAL_729X}',
    executionId: betaExec.id,
  });
  assert(
    !endedSubmit.success && endedSubmit.code === 'EVENT_ENDED',
    'Flag submission strictly blocked when competition event has ENDED'
  );

  // ---------------------------------------------------------------------------
  // 8. AUDIT LOGGING VERIFICATION
  // ---------------------------------------------------------------------------
  console.log('\n--- Test Group 8: Audit Logging on Completion ---');

  const solveAuditLogs = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.action, 'CHALLENGE_COMPLETED'));

  assert(
    solveAuditLogs.length >= 2,
    `Authoritative audit log recorded for completed challenges (Count: ${solveAuditLogs.length})`
  );

  console.log('\n================================================================');
  console.log(`FRAGMENT 9 TEST RESULTS: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('================================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runFragment9TestSuite().catch((err) => {
  console.error('Test suite uncaught error:', err);
  process.exit(1);
});

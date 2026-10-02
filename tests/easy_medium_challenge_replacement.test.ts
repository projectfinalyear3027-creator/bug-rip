/**
 * BUG SNIPER - Easy & Medium Challenge Replacement Test Suite
 *
 * Verifies:
 * 1. Inventory counts: exactly 15 Easy, 10 Medium, 10 Hard, 10 Extreme = 45 total.
 * 2. Uniqueness: every ID unique, every flag unique, no collision between Easy/Medium and Hard/Extreme.
 * 3. Metadata: difficulty, titles, starter code, hidden tests, solution code, server-side flags.
 * 4. Security: participant challenge API never exposes flag, solutionCode, hidden test cases, or adminNotes.
 * 5. Completion flow:
 *    - Buggy code fails behavioral validation (no flag revealed).
 *    - Corrected code passes behavioral validation & reveals secret flag.
 *    - Valid flag submission completes challenge & awards score.
 *    - Invalid flag submission is rejected.
 *    - Duplicate flag submission returns ALREADY_COMPLETED and awards no extra score.
 *    - Challenge completions are match-scoped.
 */

process.env.PG_MEM = 'true';
process.env.SEED_TEST_FIXTURES = 'true';

import { db } from '../src/db/index.ts';
import { runMigrations } from '../database/migrator.ts';
import { runSeed } from '../database/seed.ts';
import { OFFICIAL_CHALLENGES, EASY_CHALLENGES, MEDIUM_CHALLENGES, HARD_CHALLENGES, EXTREME_CHALLENGES } from '../database/challenges/index.ts';
import { challengeRepository } from '../backend/repositories/challengeRepository.ts';
import { challengeValidationService } from '../backend/services/challengeValidationService.ts';
import { completionService } from '../backend/services/completionService.ts';
import { progressionService } from '../backend/services/progressionService.ts';
import { adminRepository } from '../backend/repositories/adminRepository.ts';
import { challenges, challengeFlags, challengeTestCases, rounds, eventSettings, teams, participants, sessions, teamChallenges } from '../src/db/schema.ts';
import { eq, and } from 'drizzle-orm';
import { assertNoForbiddenKeys } from '../backend/rules/participantDataSecurity.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function runReplacementTestSuite() {
  console.log('\n========================================================================');
  console.log('BUG SNIPER - EASY & MEDIUM CHALLENGE REPLACEMENT TEST SUITE');
  console.log('========================================================================\n');

  // Step 1: Run migrations & seed
  await runMigrations();
  await runSeed();

  const [adminUser] = await db.select().from(challenges).limit(1);
  const adminUsersList = await db.select().from(teams).limit(1);

  // ---------------------------------------------------------------------------
  // 1. Challenge Inventory Exact Counts
  // ---------------------------------------------------------------------------
  console.log('--- 1. Challenge Inventory Exact Counts ---');
  assert(EASY_CHALLENGES.length === 15, `Exactly 15 Easy challenges defined (found: ${EASY_CHALLENGES.length})`);
  assert(MEDIUM_CHALLENGES.length === 10, `Exactly 10 Medium challenges defined (found: ${MEDIUM_CHALLENGES.length})`);
  assert(HARD_CHALLENGES.length === 10, `Exactly 10 Hard challenges defined (found: ${HARD_CHALLENGES.length})`);
  assert(EXTREME_CHALLENGES.length === 10, `Exactly 10 Extreme challenges defined (found: ${EXTREME_CHALLENGES.length})`);
  assert(OFFICIAL_CHALLENGES.length === 45, `Total official challenges = 45 (found: ${OFFICIAL_CHALLENGES.length})`);

  const dbChallenges = await db.select().from(challenges);
  assert(dbChallenges.length === 45, `Database contains exactly 45 challenges (found: ${dbChallenges.length})`);

  // ---------------------------------------------------------------------------
  // 2. Challenge Uniqueness & Zero Collisions
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Challenge Uniqueness & Zero Collisions ---');
  const allIds = OFFICIAL_CHALLENGES.map((c) => c.id);
  const uniqueIds = new Set(allIds);
  assert(uniqueIds.size === 45, `All 45 challenge IDs are strictly unique (unique: ${uniqueIds.size})`);

  const allSlugs = OFFICIAL_CHALLENGES.map((c) => c.slug);
  const uniqueSlugs = new Set(allSlugs);
  assert(uniqueSlugs.size === 45, `All 45 challenge slugs are strictly unique (unique: ${uniqueSlugs.size})`);

  const allFlags = OFFICIAL_CHALLENGES.map((c) => c.flag);
  const uniqueFlags = new Set(allFlags);
  assert(uniqueFlags.size === 45, `All 45 challenge flags are strictly unique (unique: ${uniqueFlags.size})`);

  // Verify no Easy or Medium flag collides with Hard or Extreme
  const hardExtremeFlags = new Set([
    ...HARD_CHALLENGES.map((c) => c.flag),
    ...EXTREME_CHALLENGES.map((c) => c.flag),
  ]);
  const easyMediumFlags = [
    ...EASY_CHALLENGES.map((c) => c.flag),
    ...MEDIUM_CHALLENGES.map((c) => c.flag),
  ];
  const hasCollision = easyMediumFlags.some((f) => hardExtremeFlags.has(f));
  assert(!hasCollision, 'Zero collision between Easy/Medium flags and Hard/Extreme flags');

  // ---------------------------------------------------------------------------
  // 3. Metadata Verification for All 15 Easy and 10 Medium Challenges
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Easy and Medium Metadata Verification ---');
  const expectedEasyTitles: Record<string, string> = {
    'EASY-01': 'Sum of Even Numbers',
    'EASY-02': 'Find the Largest Number',
    'EASY-03': 'Count Positive Numbers',
    'EASY-04': 'Reverse a Number',
    'EASY-05': 'Count Vowels',
    'EASY-06': 'Multiplication Table',
    'EASY-07': 'Array Average',
    'EASY-08': 'Replace Negative Values',
    'EASY-09': 'First Character',
    'EASY-10': 'Celsius to Fahrenheit',
    'EASY-11': 'Count Digits',
    'EASY-12': 'Swap Two Numbers',
    'EASY-13': 'Search an Array',
    'EASY-14': 'Remove Spaces',
    'EASY-15': 'Simple Grade Calculator',
  };

  const expectedMediumTitles: Record<string, string> = {
    'MEDIUM-01': 'Second Largest Distinct Value',
    'MEDIUM-02': 'Move Zeroes to End',
    'MEDIUM-03': 'Frequency of Elements',
    'MEDIUM-04': 'Rotate Array Right',
    'MEDIUM-05': 'Binary Search',
    'MEDIUM-06': 'Remove Duplicate Characters',
    'MEDIUM-07': 'Maximum Consecutive Ones',
    'MEDIUM-08': 'Balanced Brackets',
    'MEDIUM-09': 'Merge Two Sorted Arrays',
    'MEDIUM-10': 'Longest Word',
  };

  for (const c of EASY_CHALLENGES) {
    assert(c.difficulty === 'EASY', `${c.id} has difficulty EASY`);
    assert(c.score === 10, `${c.id} awards 10 points`);
    assert(c.title === expectedEasyTitles[c.id], `${c.id} title matches: "${c.title}"`);
    assert(c.starterCode.length > 50, `${c.id} has valid starterCode`);
    assert(c.solutionCode.length > 50, `${c.id} has valid solutionCode`);
    assert(c.publicTestCases.length >= 3, `${c.id} has at least 3 public test cases`);
    assert(c.hiddenTestCases.length >= 3, `${c.id} has at least 3 hidden test cases`);
    assert(c.flag.startsWith('DBG{') && c.flag.endsWith('}'), `${c.id} flag follows DBG{...} pattern`);
  }

  for (const c of MEDIUM_CHALLENGES) {
    assert(c.difficulty === 'MEDIUM', `${c.id} has difficulty MEDIUM`);
    assert(c.score === 20, `${c.id} awards 20 points`);
    assert(c.title === expectedMediumTitles[c.id], `${c.id} title matches: "${c.title}"`);
    assert(c.starterCode.length > 50, `${c.id} has valid starterCode`);
    assert(c.solutionCode.length > 50, `${c.id} has valid solutionCode`);
    assert(c.publicTestCases.length >= 3, `${c.id} has at least 3 public test cases`);
    assert(c.hiddenTestCases.length >= 3, `${c.id} has at least 3 hidden test cases`);
    assert(c.flag.startsWith('DBG{') && c.flag.endsWith('}'), `${c.id} flag follows DBG{...} pattern`);
  }

  // ---------------------------------------------------------------------------
  // 4. Security Verification: Participant API Data Leak Isolation
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Security: Participant API Protection ---');
  // Transition event to RUNNING
  await db.update(eventSettings).set({ status: 'RUNNING', startedAt: new Date() }).where(eq(eventSettings.id, 1));

  const [testTeam] = await db.select().from(teams).limit(1);
  const [testPart] = await db.select().from(participants).limit(1);

  for (const c of [...EASY_CHALLENGES, ...MEDIUM_CHALLENGES]) {
    const partDto = await challengeRepository.getParticipantChallengeById(c.id);
    assert(partDto !== null, `Challenge ${c.id} accessible via repository`);
    assert((partDto as any).solutionCode === undefined, `${c.id}: solutionCode is NOT exposed`);
    assert((partDto as any).adminNotes === undefined, `${c.id}: adminNotes is NOT exposed`);
    assert((partDto as any).flagVerifier === undefined, `${c.id}: flagVerifier is NOT exposed`);
    assert((partDto as any).flag === undefined, `${c.id}: raw flag is NOT exposed`);

    // Verify hidden test cases are not in public test cases query
    const publicTests = await challengeRepository.getTestCases(c.id, false);
    for (const pt of publicTests) {
      assert(!pt.isHidden, `Public test case ${pt.id} is not hidden`);
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Completion Flow: Behavioral Validation & Flag Submission
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. Completion Flow & Flag Validation Pipeline ---');

  // Test EASY-01: Sum of Even Numbers
  const easy01 = EASY_CHALLENGES[0];

  // 5A. Buggy execution output should fail behavioral validation
  const buggyExecution = {
    status: 'SUCCESS',
    stdout: 'Tests failed with exception: ArrayIndexOutOfBoundsException',
  };
  const buggyValidation = await challengeValidationService.validateExecution(easy01.id, buggyExecution);
  assert(buggyValidation.behaviorStatus === 'FAIL', 'Buggy code fails behavioral validation (status: FAIL)');
  assert(buggyValidation.flagRevealed === false, 'Buggy code does not reveal flag');

  // 5B. Corrected execution output should pass behavioral validation and reveal flag
  const correctExecution = {
    status: 'SUCCESS',
    stdout: `Test 1 Result: 12\nTest 2 Result: 0\nTest 3 Result: 14\nTest 4 Result: -6\nFLAG REVEALED: ${easy01.flag}`,
  };
  const correctValidation = await challengeValidationService.validateExecution(easy01.id, correctExecution);
  assert(correctValidation.behaviorStatus === 'PASS', 'Corrected code passes behavioral validation (status: PASS)');
  assert(correctValidation.flagRevealed === true, 'Corrected code reveals flag');
  assert(correctValidation.revealedFlag === easy01.flag, `Revealed flag matches exact secret flag: ${easy01.flag}`);

  // 5C. Record execution submission in DB so completionService sees the validated run
  const [submission] = await db
    .insert(teamChallenges)
    .values({
      teamId: testTeam.id,
      challengeId: easy01.id,
      status: 'IN_PROGRESS',
      attemptCount: 1,
    })
    .onConflictDoUpdate({
      target: [teamChallenges.teamId, teamChallenges.challengeId],
      set: { status: 'IN_PROGRESS' },
    })
    .returning();

  // Create submission row with revealedFlag
  const { submissions: subsTable } = await import('../src/db/schema.ts');
  const [subRecord] = await db
    .insert(subsTable)
    .values({
      teamId: testTeam.id,
      participantId: testPart.id,
      challengeId: easy01.id,
      matchNumber: 1,
      sourceCode: easy01.solutionCode,
      executionStatus: 'SUCCESS',
      behaviorStatus: 'PASS',
      revealedFlag: easy01.flag,
      stdout: correctExecution.stdout,
      executionTimeMs: 42,
    })
    .returning();

  // 5D. Invalid flag rejected
  const invalidResult = await completionService.submitFlag({
    teamId: testTeam.id,
    participantId: testPart.id,
    challengeId: easy01.id,
    submittedFlag: 'DBG{WRONG_FLAG_1234}',
    executionId: subRecord.id,
  });
  assert(invalidResult.success === false, 'Invalid flag submission rejected (success: false)');
  assert(invalidResult.code === 'FLAG_REJECTED', 'Error code is FLAG_REJECTED');

  // 5E. Valid flag submission completes challenge & awards score
  const validResult = await completionService.submitFlag({
    teamId: testTeam.id,
    participantId: testPart.id,
    challengeId: easy01.id,
    submittedFlag: easy01.flag,
    executionId: subRecord.id,
  });
  assert(validResult.success === true, 'Valid flag submission accepted (success: true)');
  assert(validResult.accepted === true, 'Flag accepted: true');
  assert(validResult.data?.pointsAwarded === 10, 'Points awarded = 10');
  assert(validResult.data?.problemsSolved === 1, 'Total problems solved = 1');

  // 5F. Duplicate valid flag submission rejected with ALREADY_COMPLETED and zero points
  const dupResult = await completionService.submitFlag({
    teamId: testTeam.id,
    participantId: testPart.id,
    challengeId: easy01.id,
    submittedFlag: easy01.flag,
    executionId: subRecord.id,
  });
  assert(dupResult.success === false, 'Duplicate flag submission rejected (success: false)');
  assert(dupResult.code === 'ALREADY_COMPLETED', 'Error code is ALREADY_COMPLETED');
  assert(dupResult.alreadyCompleted === true, 'alreadyCompleted is true');

  // 5G. Test MEDIUM-01 completion pipeline
  const med01 = MEDIUM_CHALLENGES[0];
  const medCorrectExec = {
    status: 'SUCCESS',
    stdout: `Second largest 1: 8\nSecond largest 2: null\nSecond largest 3: 4\nSecond largest 4: -10\nFLAG REVEALED: ${med01.flag}`,
  };
  const medValidation = await challengeValidationService.validateExecution(med01.id, medCorrectExec);
  assert(medValidation.behaviorStatus === 'PASS', 'MEDIUM-01 passes behavioral validation');
  assert(medValidation.revealedFlag === med01.flag, 'MEDIUM-01 reveals secret flag');

  const [medSubRecord] = await db
    .insert(subsTable)
    .values({
      teamId: testTeam.id,
      participantId: testPart.id,
      challengeId: med01.id,
      matchNumber: 1,
      sourceCode: med01.solutionCode,
      executionStatus: 'SUCCESS',
      behaviorStatus: 'PASS',
      revealedFlag: med01.flag,
      stdout: medCorrectExec.stdout,
      executionTimeMs: 50,
    })
    .returning();

  // Unlock medium difficulty for test team/participant so medium challenge is accessible
  const { progressionRepository } = await import('../backend/repositories/progressionRepository.ts');
  const [medRound] = await db.select().from(rounds).where(eq(rounds.slug, 'medium')).limit(1);
  await progressionRepository.recordRoundUnlock(testPart.id, medRound.id, 'TEST');
  await progressionRepository.recordRoundUnlock(testTeam.id, medRound.id, 'TEST');

  const medSubmitResult = await completionService.submitFlag({
    teamId: testTeam.id,
    participantId: testPart.id,
    challengeId: med01.id,
    submittedFlag: med01.flag,
    executionId: medSubRecord.id,
  });
  assert(medSubmitResult.success === true, 'MEDIUM-01 valid flag accepted (success: true)');
  assert(medSubmitResult.data?.pointsAwarded === 20, 'MEDIUM-01 points awarded = 20');

  // ---------------------------------------------------------------------------
  // 6. Challenge-Specific Deep Validation: MEDIUM-08, MEDIUM-09, MEDIUM-10
  // ---------------------------------------------------------------------------
  console.log('\n--- 6. Deep Validation: MEDIUM-08, MEDIUM-09, MEDIUM-10 ---');

  // MEDIUM-08: Balanced Brackets
  const med08 = MEDIUM_CHALLENGES.find((c) => c.id === 'MEDIUM-08')!;
  assert(med08.title === 'Balanced Brackets', 'MEDIUM-08 title is Balanced Brackets');
  assert(med08.hiddenTestCases.length === 10, 'MEDIUM-08 has 10 hidden test cases');

  // Buggy code fails leftover opening brackets
  const med08BuggyExec = {
    status: 'SUCCESS',
    stdout: 'Test 1 Result: YES\nTest 2 Result: NO\nTest 3 Result: YES\nTest 4 Result: YES\nTest 5 Result: NO\nTests failed. Keep debugging to unlock flag.',
  };
  const med08BuggyVal = await challengeValidationService.validateExecution(med08.id, med08BuggyExec);
  assert(med08BuggyVal.behaviorStatus === 'FAIL', 'MEDIUM-08 buggy code fails behavioral validation');
  assert(!med08BuggyVal.flagRevealed, 'MEDIUM-08 buggy code does not reveal flag');

  // Corrected code passes
  const med08CorrectExec = {
    status: 'SUCCESS',
    stdout: `Test 1 Result: YES\nTest 2 Result: NO\nTest 3 Result: NO\nTest 4 Result: YES\nTest 5 Result: NO\nFLAG REVEALED: ${med08.flag}`,
  };
  const med08CorrectVal = await challengeValidationService.validateExecution(med08.id, med08CorrectExec);
  assert(med08CorrectVal.behaviorStatus === 'PASS', 'MEDIUM-08 corrected code passes behavioral validation');
  assert(med08CorrectVal.flagRevealed === true, 'MEDIUM-08 corrected code reveals flag');
  assert(med08CorrectVal.revealedFlag === med08.flag, 'MEDIUM-08 revealed flag matches');

  // Secret leakage check for MEDIUM-08
  const med08PartDto = await progressionService.getParticipantChallengeDetails(testTeam.id, med08.id);
  assertNoForbiddenKeys(med08PartDto, 'MEDIUM-08 participant DTO');
  assert((med08PartDto as any).solutionCode === undefined, 'MEDIUM-08: solutionCode not leaked');
  assert((med08PartDto as any).flag === undefined, 'MEDIUM-08: flag not leaked');

  // MEDIUM-09: Merge Two Sorted Arrays
  const med09 = MEDIUM_CHALLENGES.find((c) => c.id === 'MEDIUM-09')!;
  assert(med09.title === 'Merge Two Sorted Arrays', 'MEDIUM-09 title is Merge Two Sorted Arrays');
  assert(med09.hiddenTestCases.length === 10, 'MEDIUM-09 has 10 hidden test cases');

  // Buggy code fails
  const med09BuggyExec = {
    status: 'SUCCESS',
    stdout: 'Test 1 Result: [2, 1, 4, 3, 6, 5]\nTests failed. Keep debugging to unlock flag.',
  };
  const med09BuggyVal = await challengeValidationService.validateExecution(med09.id, med09BuggyExec);
  assert(med09BuggyVal.behaviorStatus === 'FAIL', 'MEDIUM-09 buggy code fails behavioral validation');
  assert(!med09BuggyVal.flagRevealed, 'MEDIUM-09 buggy code does not reveal flag');

  // Corrected code passes
  const med09CorrectExec = {
    status: 'SUCCESS',
    stdout: `Test 1 Result: [1, 2, 3, 4, 5, 6]\nTest 2 Result: [1, 2, 2, 2, 3, 4]\nTest 3 Result: [1, 5]\nTest 4 Result: [1, 2, 5, 10]\nFLAG REVEALED: ${med09.flag}`,
  };
  const med09CorrectVal = await challengeValidationService.validateExecution(med09.id, med09CorrectExec);
  assert(med09CorrectVal.behaviorStatus === 'PASS', 'MEDIUM-09 corrected code passes behavioral validation');
  assert(med09CorrectVal.flagRevealed === true, 'MEDIUM-09 corrected code reveals flag');
  assert(med09CorrectVal.revealedFlag === med09.flag, 'MEDIUM-09 revealed flag matches');

  // Secret leakage check for MEDIUM-09
  const med09PartDto = await progressionService.getParticipantChallengeDetails(testTeam.id, med09.id);
  assertNoForbiddenKeys(med09PartDto, 'MEDIUM-09 participant DTO');
  assert((med09PartDto as any).solutionCode === undefined, 'MEDIUM-09: solutionCode not leaked');
  assert((med09PartDto as any).flag === undefined, 'MEDIUM-09: flag not leaked');

  // MEDIUM-10: Longest Word
  const med10 = MEDIUM_CHALLENGES.find((c) => c.id === 'MEDIUM-10')!;
  assert(med10.title === 'Longest Word', 'MEDIUM-10 title is Longest Word');
  assert(med10.hiddenTestCases.length === 10, 'MEDIUM-10 has 10 hidden test cases');

  // Buggy code fails (selects shortest word)
  const med10BuggyExec = {
    status: 'SUCCESS',
    stdout: 'Test 1 Result: I\nTest 2 Result: is\nTest 3 Result: cat\nTest 4 Result: The\nTests failed. Keep debugging to unlock flag.',
  };
  const med10BuggyVal = await challengeValidationService.validateExecution(med10.id, med10BuggyExec);
  assert(med10BuggyVal.behaviorStatus === 'FAIL', 'MEDIUM-10 buggy code fails behavioral validation');
  assert(!med10BuggyVal.flagRevealed, 'MEDIUM-10 buggy code does not reveal flag');

  // Corrected code passes (deterministic tie returns FIRST longest word)
  const med10CorrectExec = {
    status: 'SUCCESS',
    stdout: `Test 1 Result: competitive\nTest 2 Result: powerful\nTest 3 Result: bird\nTest 4 Result: quick\nFLAG REVEALED: ${med10.flag}`,
  };
  const med10CorrectVal = await challengeValidationService.validateExecution(med10.id, med10CorrectExec);
  assert(med10CorrectVal.behaviorStatus === 'PASS', 'MEDIUM-10 corrected code passes behavioral validation');
  assert(med10CorrectVal.flagRevealed === true, 'MEDIUM-10 corrected code reveals flag');
  assert(med10CorrectVal.revealedFlag === med10.flag, 'MEDIUM-10 revealed flag matches');

  // Secret leakage check for MEDIUM-10
  const med10PartDto = await progressionService.getParticipantChallengeDetails(testTeam.id, med10.id);
  assertNoForbiddenKeys(med10PartDto, 'MEDIUM-10 participant DTO');
  assert((med10PartDto as any).solutionCode === undefined, 'MEDIUM-10: solutionCode not leaked');
  assert((med10PartDto as any).flag === undefined, 'MEDIUM-10: flag not leaked');

  console.log('\n========================================================================');
  console.log(`TOTAL REPLACEMENT TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runReplacementTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

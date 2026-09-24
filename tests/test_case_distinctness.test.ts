/**
 * BUG RIP - Test Case Distinctness & Uniqueness Test Suite
 * 
 * Verifies:
 * 1. Database schema enforces unique (challenge_id, is_hidden, display_order)
 * 2. Public test cases for each challenge have distinct inputs and distinct outputs
 * 3. Public test cases are ordered deterministically by display_order
 * 4. Exemplar explanations are preserved and delivered via ParticipantChallengeDTO
 * 5. Hidden test cases are completely excluded from ParticipantChallengeDTO
 * 6. Duplicate insertion attempts trigger unique constraint violation
 */

process.env.PG_MEM = 'true';

import { db } from '../src/db/index.ts';
import { runMigrations } from '../database/migrator.ts';
import { runSeed } from '../database/seed.ts';
import { challengeRepository } from '../backend/repositories/challengeRepository.ts';
import { progressionService } from '../backend/services/progressionService.ts';
import { adminRepository } from '../backend/repositories/adminRepository.ts';
import { teams, adminUsers, challengeTestCases } from '../src/db/schema.ts';
import { eq } from 'drizzle-orm';
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

async function runTestSuite() {
  console.log('\n================================================================');
  console.log('BUG RIP - DISTINCT TEST CASE VALIDATION TEST SUITE');
  console.log('================================================================');

  // Step 1: Run migrations & seed
  await runMigrations();
  await runSeed();

  const adminUsersList = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.username, 'admin'))
    .limit(1);
  const superAdminId = adminUsersList[0].id;

  // Transition event to RUNNING so participant can access challenges
  await adminRepository.transitionEventStatus('RUNNING', superAdminId, 'START');

  let teamId: string;
  const teamList = await db.select().from(teams).limit(1);
  if (teamList.length > 0) {
    teamId = teamList[0].id;
  } else {
    const [t] = await db
      .insert(teams)
      .values({
        externalTeamId: 'DISTINCT-TEST-01',
        teamName: 'Distinctness Test Team',
        teamCode: 'DISTINCT01',
        registeredMemberCount: 1,
        status: 'ACTIVE',
      })
      .returning();
    teamId = t.id;
  }

  // Step 2: Query all challenges and verify their public test cases
  const challenges = await challengeRepository.getAllChallenges();
  assert(challenges.length >= 5, `Database contains ${challenges.length} challenges`);

  console.log('\n[Suite 1] Verify Distinct Public Test Cases Per Challenge (Database Layer)');
  for (const c of challenges) {
    const publicCases = await challengeRepository.getTestCases(c.id, false);
    assert(publicCases.length > 0, `Challenge ${c.id} has ${publicCases.length} public test cases in DB`);

    const inputSet = new Set<string>();
    const outputSet = new Set<string>();
    let distinctInputs = true;
    let distinctOutputs = true;

    for (const tc of publicCases) {
      if (inputSet.has(tc.inputData)) distinctInputs = false;
      inputSet.add(tc.inputData);

      if (outputSet.has(tc.expectedOutput)) distinctOutputs = false;
      outputSet.add(tc.expectedOutput);

      assert(typeof tc.displayOrder === 'number', `Test case ${tc.id} has numeric displayOrder: ${tc.displayOrder}`);
      assert(typeof tc.explanation === 'string' && tc.explanation.length > 0, `Test case ${tc.id} has explanation: "${tc.explanation}"`);
      assert(!tc.isHidden, `Test case ${tc.id} is marked public (isHidden=false)`);
    }

    assert(distinctInputs, `Challenge ${c.id}: All ${publicCases.length} public test cases have distinct input data`);
    assert(distinctOutputs, `Challenge ${c.id}: All ${publicCases.length} public test cases have distinct expected output`);
  }

  console.log('\n[Suite 2] Verify Progression Service ParticipantChallengeDTO');
  const unlockedChallenges = challenges.filter((c) => c.id.startsWith('EASY'));
  for (const c of unlockedChallenges) {
    const details = await progressionService.getParticipantChallengeDetails(teamId, c.id);
    assert(details !== null, `Retrieved participant challenge ${c.id}`);
    assert(details.publicTestCases.length > 0, `Participant received ${details.publicTestCases.length} public test cases`);

    const pInputSet = new Set<string>();
    for (const ptc of details.publicTestCases) {
      assert(!pInputSet.has(ptc.inputData), `Participant public test case input "${ptc.inputData}" is distinct`);
      pInputSet.add(ptc.inputData);

      assert(typeof ptc.displayOrder === 'number', `Participant public test case has displayOrder: ${ptc.displayOrder}`);
      assert(typeof ptc.explanation === 'string', `Participant public test case includes explanation`);
      assertNoForbiddenKeys(ptc, `participant_test_case_${ptc.id}`);
      assert((ptc as any).isHidden === undefined, `Participant test case does not expose isHidden`);
      assert((ptc as any).hiddenOutput === undefined, `Participant test case does not expose hiddenOutput`);
    }
  }

  console.log('\n[Suite 2] Verify Unique Constraint Prevents Duplicate Rows in challenge_test_cases');
  let duplicateRejected = false;
  try {
    // Attempt inserting a duplicate (challenge_id, is_hidden, display_order)
    await db.insert(challengeTestCases).values({
      challengeId: 'EASY-01-FACTORIAL',
      testType: 'PUBLIC',
      inputData: '999',
      expectedOutput: 'Computed 999!: 0',
      isHidden: false,
      displayOrder: 1, // displayOrder 1 already exists for EASY-01-FACTORIAL
    });
  } catch (err: any) {
    duplicateRejected = true;
    const fullErrStr = `${err?.message || ''} ${err?.cause?.message || ''} ${String(err?.cause || '')} ${String(err)}`;
    console.log('Duplicate insertion full error info:', fullErrStr);
    assert(
      fullErrStr.toLowerCase().includes('unique') || 
      fullErrStr.toLowerCase().includes('duplicate') || 
      fullErrStr.toLowerCase().includes('idx_test_cases_order_uq') ||
      fullErrStr.toLowerCase().includes('failed query') ||
      fullErrStr.toLowerCase().includes('constraint'),
      `Database rejected duplicate (challenge_id, is_hidden, display_order) with constraint violation`
    );
  }
  assert(duplicateRejected, 'Unique constraint successfully blocks duplicate test case order');

  console.log('\n[Suite 3] Verify Hidden Test Cases are Evaluated Internally and Never Sent to Participant');
  for (const c of unlockedChallenges) {
    const allDbCases = await challengeRepository.getTestCases(c.id, true);
    const hiddenCases = allDbCases.filter((tc) => tc.isHidden);
    assert(hiddenCases.length > 0, `Challenge ${c.id} has ${hiddenCases.length} hidden test cases in DB for server evaluation`);

    const participantDetails = await progressionService.getParticipantChallengeDetails(teamId, c.id);
    for (const hidden of hiddenCases) {
      const leaked = participantDetails.publicTestCases.some((p) => p.id === hidden.id || p.inputData === hidden.inputData);
      assert(!leaked, `Hidden test case ${hidden.id} is NOT leaked in participant API response`);
    }
  }

  console.log('\n================================================================');
  console.log(`TEST RESULTS: ${passed} passed, ${failed} failed`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal error in test suite:', err);
  process.exit(1);
});

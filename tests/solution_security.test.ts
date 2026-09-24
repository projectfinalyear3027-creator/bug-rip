/**
 * BUG RIP - Solution Java Security & Anti-Leak Validation Tests
 * 
 * Verifies:
 * 1. Participant Challenge Query Isolation (Only safe public fields selected)
 * 2. Absolute Absence of Solution Code / Reference Answers in Participant DTOs
 * 3. Absolute Absence of Flag Verifiers, Hashes, and Hidden Test Cases
 * 4. Starter Code Integrity (Contains ONLY buggy Java code, no spoiler comments)
 * 5. Database Schema & Storage (solution_code and admin_notes stored for admins)
 * 6. Admin vs Participant API Boundary Enforcement
 * 7. Recursive Prohibited Key Scanner (Throws on any leak attempt)
 */

process.env.PG_MEM = 'true';

import { db } from '../src/db/index.ts';
import { runMigrations } from '../database/migrator.ts';
import { runSeed } from '../database/seed.ts';
import { challengeRepository } from '../backend/repositories/challengeRepository.ts';
import { progressionService } from '../backend/services/progressionService.ts';
import { adminRepository } from '../backend/repositories/adminRepository.ts';
import { teams, adminUsers } from '../src/db/schema.ts';
import { eq } from 'drizzle-orm';
import {
  assertNoForbiddenKeys,
  PROHIBITED_PARTICIPANT_KEYS,
  toParticipantChallengeDTO,
} from '../backend/rules/participantDataSecurity.ts';

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

async function runSolutionSecurityTestSuite() {
  console.log('\n================================================================');
  console.log('BUG RIP - SOLUTION JAVA SECURITY & ANTI-LEAK TEST SUITE');
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

  // Start competition so challenges can be fetched by participants
  await adminRepository.transitionEventStatus('RUNNING', superAdminId, 'START');

  const team1List = await db
    .select()
    .from(teams)
    .where(eq(teams.teamName, 'Development Team Alpha'))
    .limit(1);
  const team1 = team1List[0];

  console.log('\n[Suite 1] Database Storage & Private Fields Validation');
  const allAdminChallenges = await challengeRepository.getAllChallenges();
  assert(allAdminChallenges.length >= 5, `Seeded at least 5 challenges (found ${allAdminChallenges.length})`);

  for (const c of allAdminChallenges) {
    assert(
      typeof (c as any).starterCode === 'string' && (c as any).starterCode.length > 20,
      `Challenge ${c.id}: has valid starterCode`
    );
    assert(
      typeof (c as any).solutionCode === 'string' && (c as any).solutionCode.length > 20,
      `Challenge ${c.id}: admin can access private solutionCode`
    );
    assert(
      typeof (c as any).adminNotes === 'string' && (c as any).adminNotes.length > 10,
      `Challenge ${c.id}: admin can access private adminNotes`
    );
    // Ensure starter code does NOT contain solution give-aways like "// BUG: Should be"
    assert(
      !(c as any).starterCode.includes('// BUG:'),
      `Challenge ${c.id}: starterCode does not contain giveaway "// BUG:" comments`
    );
  }

  console.log('\n[Suite 2] Participant-Safe Repository Query (Database Layer Isolation)');
  const participantDbRecord = await challengeRepository.getParticipantChallengeById('EASY-01-FACTORIAL');
  assert(participantDbRecord !== null, 'Found challenge via getParticipantChallengeById');

  // Verify that solutionCode, adminNotes are NOT selected
  assert(
    (participantDbRecord as any).solutionCode === undefined,
    'getParticipantChallengeById does NOT select solutionCode'
  );
  assert(
    (participantDbRecord as any).adminNotes === undefined,
    'getParticipantChallengeById does NOT select adminNotes'
  );
  assert(
    (participantDbRecord as any).flagVerifier === undefined,
    'getParticipantChallengeById does NOT select flagVerifier'
  );

  console.log('\n[Suite 3] Participant Progression Service DTO Protection');
  const participantDetails = await progressionService.getParticipantChallengeDetails(
    team1.id,
    'EASY-01-FACTORIAL'
  );

  assert(participantDetails !== null, 'Retrieved participant challenge details successfully');
  assert(
    typeof participantDetails.starterCode === 'string',
    'participantDetails contains starterCode (the buggy code to debug)'
  );

  // Deep check: assert no forbidden keys exist in the returned participant object
  let threwOnValidDto = false;
  try {
    assertNoForbiddenKeys(participantDetails, 'test_participant_details');
  } catch (err) {
    threwOnValidDto = true;
  }
  assert(!threwOnValidDto, 'assertNoForbiddenKeys passes cleanly on participant challenge DTO');

  // Verify none of the prohibited keys are present
  for (const key of PROHIBITED_PARTICIPANT_KEYS) {
    assert(
      !(key in participantDetails),
      `participantDetails does not contain forbidden key "${key}"`
    );
  }

  // Verify test cases sent to participant are public only
  assert(
    participantDetails.publicTestCases.length > 0,
    'participantDetails has public test cases'
  );
  for (const tc of participantDetails.publicTestCases) {
    assert(
      (tc as any).isHidden === undefined,
      'Test case in participant projection does not leak isHidden boolean'
    );
    assert(
      (tc as any).hiddenOutput === undefined,
      'Test case in participant projection does not leak hiddenOutput'
    );
  }

  console.log('\n[Suite 4] Anti-Leak Scanner (Catches Unauthorized Keys)');
  let caughtLeak = false;
  try {
    const leakyObject = {
      id: 'CHALLENGE-1',
      starterCode: 'public class Main {}',
      solutionCode: 'public class Main { /* fixed */ }',
    };
    assertNoForbiddenKeys(leakyObject, 'leaky_test');
  } catch (err: any) {
    caughtLeak = true;
    assert(
      err.message.includes('solutionCode'),
      'assertNoForbiddenKeys accurately identified the prohibited solutionCode field'
    );
  }
  assert(caughtLeak, 'assertNoForbiddenKeys successfully threw on unauthorized solutionCode field');

  console.log('\n================================================================');
  console.log(`SOLUTION SECURITY TEST SUMMARY: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('================================================================');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runSolutionSecurityTestSuite().catch((err) => {
  console.error('Fatal error running solution security tests:', err);
  process.exit(1);
});

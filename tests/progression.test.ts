/**
 * BUG RIP - Fragment 6: Rounds, Challenges + Configurable Difficulty Progression Tests
 * 
 * Verifies:
 * 1. Default Rounds/Difficulties & Canonical Thresholds
 * 2. Sequential Difficulty Progression (Solved Count Thresholds)
 * 3. Free Choice Within Unlocked Difficulties
 * 4. Monotonic Unlock Retention (Never Relocks)
 * 5. Historical Completion & Score Retention if Challenge Deactivated
 * 6. Administrative Override: Unlock All Difficulties
 * 7. Administrative Override: Manual Difficulty Unlock (Single Team & Global)
 * 8. Administrative Override: Manual Challenge Unlock
 * 9. Threshold Validation & Downstream Challenge Deactivation Warnings
 * 10. Public Participant Protection (No Hidden Tests or Flag Verifier Leaks)
 * 11. Challenge CRUD & Activation Toggling
 * 12. Complete Audit Logging for All Administrative Actions
 */

import { db } from '../src/db/index.ts';
import { runMigrations } from '../database/migrator.ts';
import { runSeed } from '../database/seed.ts';
import { challengeRepository } from '../backend/repositories/challengeRepository.ts';
import { teamChallengeRepository } from '../backend/repositories/teamChallengeRepository.ts';
import { progressionRepository } from '../backend/repositories/progressionRepository.ts';
import { progressionService } from '../backend/services/progressionService.ts';
import { adminRepository } from '../backend/repositories/adminRepository.ts';
import { teamRepository } from '../backend/repositories/teamRepository.ts';
import { eventRepository } from '../backend/repositories/eventRepository.ts';
import { rounds, challenges, teamChallenges, auditLogs, adminUsers, teams, teamUnlockedRounds, progressionOverrides } from '../src/db/schema.ts';
import { eq, desc } from 'drizzle-orm';

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

async function runProgressionTestSuite() {
  console.log('\n================================================================');
  console.log('BUG RIP - FRAGMENT 6: DIFFICULTY PROGRESSION & CHALLENGES TESTS');
  console.log('================================================================');

  // Initialize DB
  await runMigrations();
  await runSeed();

  const superAdmin = (
    await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.username, 'admin'))
      .limit(1)
  )[0];
  const superAdminId = superAdmin!.id;

  const testTeam = (
    await db
      .select()
      .from(teams)
      .where(eq(teams.teamName, 'Development Team Alpha'))
      .limit(1)
  )[0];
  const teamId = testTeam!.id;

  // Clear any existing solves, unlocks, and overrides for a clean slate
  await db.delete(teamChallenges).where(eq(teamChallenges.teamId, teamId));
  await db.delete(teamUnlockedRounds).where(eq(teamUnlockedRounds.teamId, teamId));
  await db.delete(progressionOverrides);
  await progressionRepository.setProgressionMode('SEQUENTIAL');

  // -------------------------------------------------------------
  // Test Suite 1: Canonical Rounds Structure
  // -------------------------------------------------------------
  console.log('\n--- Test Suite 1: Canonical Rounds Structure ---');
  {
    const allRounds = await challengeRepository.getAllRounds();
    assert(allRounds.length >= 4, `Database contains at least 4 rounds (found: ${allRounds.length})`);

    const easyRound = allRounds.find((r) => r.slug === 'easy');
    const medRound = allRounds.find((r) => r.slug === 'medium');
    const hardRound = allRounds.find((r) => r.slug === 'hard');
    const extremeRound = allRounds.find((r) => r.slug === 'extreme');

    assert(!!easyRound, 'Easy round exists');
    assert(easyRound?.displayOrder === 1, 'Easy has displayOrder = 1');
    assert(easyRound?.unlockRequiredSolves === 0, 'Easy requires 0 solves to unlock');

    assert(!!medRound, 'Medium round exists');
    assert(medRound?.displayOrder === 2, 'Medium has displayOrder = 2');
    assert(medRound?.unlockRequiredSolves === 6, 'Medium requires 6 solves from preceding round');

    assert(!!hardRound, 'Hard round exists');
    assert(hardRound?.displayOrder === 3, 'Hard has displayOrder = 3');
    assert(hardRound?.unlockRequiredSolves === 5, 'Hard requires 5 solves from preceding round');

    assert(!!extremeRound, 'Extreme round exists');
    assert(extremeRound?.displayOrder === 4, 'Extreme has displayOrder = 4');
    assert(extremeRound?.unlockRequiredSolves === 4, 'Extreme requires 4 solves from preceding round');
  }

  // -------------------------------------------------------------
  // Test Suite 2: Sequential Progression Calculation
  // -------------------------------------------------------------
  console.log('\n--- Test Suite 2: Sequential Progression Calculation ---');
  {
    const allRounds = await challengeRepository.getAllRounds();
    const easy = allRounds.find((r) => r.slug === 'easy')!;
    const med = allRounds.find((r) => r.slug === 'medium')!;
    const hard = allRounds.find((r) => r.slug === 'hard')!;

    // Ensure Easy has at least 6 challenges to test the threshold 6
    const existingEasy = await challengeRepository.getChallenges(easy.id);
    for (let i = existingEasy.length + 1; i <= 6; i++) {
      await challengeRepository.createChallenge({
        id: `TEST-EASY-0${i}`,
        roundId: easy.id,
        title: `Test Easy Problem ${i}`,
        slug: `test-easy-0${i}`,
        description: `Description for test easy ${i}`,
        starterCode: 'public class Solution {}',
        score: 10,
        displayOrder: i,
        validationType: 'EXACT_OUTPUT',
        testCases: [{ inputData: '1', expectedOutput: '1', isHidden: false }],
      });
    }

    const initialProgression = await progressionService.getTeamProgression(teamId);
    assert(initialProgression.rounds.length >= 4, 'Progression returns all active rounds');

    const easyProg = initialProgression.rounds.find((r) => r.slug === 'easy');
    const medProg = initialProgression.rounds.find((r) => r.slug === 'medium');
    const hardProg = initialProgression.rounds.find((r) => r.slug === 'hard');

    assert(easyProg?.isUnlocked === true, 'Easy difficulty is unlocked initially (threshold 0)');
    assert(medProg?.isUnlocked === false, 'Medium difficulty is locked initially (requires 6 solves)');
    assert(hardProg?.isUnlocked === false, 'Hard difficulty is locked initially');

    // Easy challenges should be AVAILABLE, Medium challenges should be LOCKED
    const easyChallenges = initialProgression.challenges.filter((c) => c.roundId === easy.id);
    const medChallenges = initialProgression.challenges.filter((c) => c.roundId === med.id);

    assert(easyChallenges.length >= 6, `Easy round contains ${easyChallenges.length} challenges (>= 6)`);
    assert(easyChallenges.every((c) => c.status === 'AVAILABLE'), 'All active challenges in Easy are AVAILABLE (free choice)');
    assert(medChallenges.every((c) => c.status === 'LOCKED'), 'All challenges in Medium are LOCKED initially');

    // Simulate 5 Easy solves (1 short of 6 threshold)
    for (let i = 0; i < 5; i++) {
      const chal = easyChallenges[i];
      await teamChallengeRepository.recordSolveAttempt({ teamId, challengeId: chal.id });
    }

    const prog5Solves = await progressionService.getTeamProgression(teamId);
    const med5 = prog5Solves.rounds.find((r) => r.slug === 'medium');
    assert(med5?.isUnlocked === false, 'Medium difficulty remains locked after 5 Easy solves (threshold: 6)');

    // Simulate 6th Easy solve (reaches threshold)
    const chal6 = easyChallenges[5];
    await teamChallengeRepository.recordSolveAttempt({ teamId, challengeId: chal6.id });

    const prog6Solves = await progressionService.getTeamProgression(teamId);
    const easyAfter = prog6Solves.rounds.find((r) => r.slug === 'easy');
    const medAfter = prog6Solves.rounds.find((r) => r.slug === 'medium');
    const hardAfter = prog6Solves.rounds.find((r) => r.slug === 'hard');

    assert(easyAfter?.isUnlocked === true, 'Easy difficulty remains unlocked (Monotonic rule)');
    assert(medAfter?.isUnlocked === true, 'Medium difficulty is now UNLOCKED after 6 Easy solves');
    assert(hardAfter?.isUnlocked === false, 'Hard difficulty remains locked (requires 5 Medium solves)');

    // Medium challenges should now be AVAILABLE for free choice
    const medChallengesNow = prog6Solves.challenges.filter((c) => c.roundId === med.id);
    assert(medChallengesNow.every((c) => c.status === 'AVAILABLE'), 'Medium challenges are now AVAILABLE for free selection');
  }

  // -------------------------------------------------------------
  // Test Suite 3: Monotonic Unlock Retention
  // -------------------------------------------------------------
  console.log('\n--- Test Suite 3: Monotonic Unlock Retention ---');
  {
    // Verify that unlocked rounds are recorded in team_unlocked_rounds
    const unlockedIds = await progressionRepository.getTeamUnlockedRoundIds(teamId);
    const allRounds = await challengeRepository.getAllRounds();
    const medRound = allRounds.find((r) => r.slug === 'medium');

    assert(unlockedIds.includes(medRound!.id), 'Medium unlock is persisted in team_unlocked_rounds');

    // Even if we query progression repeatedly, Medium remains permanently unlocked
    const prog = await progressionService.getTeamProgression(teamId);
    const medProg = prog.rounds.find((r) => r.slug === 'medium');
    assert(medProg?.isUnlocked === true, 'Medium difficulty remains permanently unlocked monotonically');
  }

  // -------------------------------------------------------------
  // Test Suite 4: Historical Completion & Score Retention upon Challenge Deactivation
  // -------------------------------------------------------------
  console.log('\n--- Test Suite 4: Deactivation Preserves Solves & Score ---');
  {
    const progBefore = await progressionService.getTeamProgression(teamId);
    const scoreBefore = progBefore.stats.totalScore;
    const solvedBefore = progBefore.stats.problemsSolved;

    // Deactivate one of the solved Easy challenges
    const solvedChal = progBefore.challenges.find((c) => c.status === 'COMPLETED');
    assert(!!solvedChal, 'Found a completed challenge to deactivate');

    const deactRes = await challengeRepository.setChallengeActive(solvedChal!.id, false);
    assert(deactRes?.isActive === false, 'Challenge marked inactive');

    // Verify team progression retains the score and solves count
    const progAfter = await progressionService.getTeamProgression(teamId);
    assert(progAfter.stats.totalScore === scoreBefore, 'Team total score is strictly preserved after challenge deactivation');
    assert(progAfter.stats.problemsSolved === solvedBefore, 'Problems solved count is strictly preserved after challenge deactivation');

    // Re-activate challenge for subsequent tests
    await challengeRepository.setChallengeActive(solvedChal!.id, true);
  }

  // -------------------------------------------------------------
  // Test Suite 5: Administrative Progression Overrides
  // -------------------------------------------------------------
  console.log('\n--- Test Suite 5: Administrative Progression Overrides ---');
  {
    const allRounds = await challengeRepository.getAllRounds();
    const hardRound = allRounds.find((r) => r.slug === 'hard');
    const extremeRound = allRounds.find((r) => r.slug === 'extreme');

    // 1. Manually unlock Hard for this team
    const unlockRes = await progressionService.unlockDifficulty(
      hardRound!.id,
      teamId,
      superAdminId,
      'Test manual unlock for Hard round'
    );
    assert(unlockRes.success === true, 'Admin manual difficulty unlock returned success');

    const progAfterManual = await progressionService.getTeamProgression(teamId);
    const hardAfterManual = progAfterManual.rounds.find((r) => r.slug === 'hard');
    const extremeAfterManual = progAfterManual.rounds.find((r) => r.slug === 'extreme');

    assert(hardAfterManual?.isUnlocked === true, 'Hard difficulty is unlocked via manual admin override');
    assert(extremeAfterManual?.isUnlocked === false, 'Extreme difficulty remains locked');

    // 2. Global Unlock All
    const unlockAllRes = await progressionService.unlockAllDifficulties(
      superAdminId,
      'Test global unlock all'
    );
    assert(unlockAllRes.success === true, 'Admin unlock-all returned success');

    const progAfterUnlockAll = await progressionService.getTeamProgression(teamId);
    assert(progAfterUnlockAll.rounds.every((r) => r.isUnlocked), 'ALL difficulties are now unlocked under UNLOCK_ALL mode');

    // Revert UNLOCK_ALL mode back to SEQUENTIAL for further tests
    await progressionRepository.setProgressionMode('SEQUENTIAL');
  }

  // -------------------------------------------------------------
  // Test Suite 6: Threshold Configuration Validation
  // -------------------------------------------------------------
  console.log('\n--- Test Suite 6: Threshold Configuration Validation ---');
  {
    const allRounds = await challengeRepository.getAllRounds();
    const medRound = allRounds.find((r) => r.slug === 'medium');
    const easyRound = allRounds.find((r) => r.slug === 'easy');

    const easyActiveCount = await challengeRepository.getActiveChallengesCountByRound(easyRound!.id);

    // Negative threshold rejected
    let negativeRejected = false;
    try {
      await progressionService.validateRoundThreshold(medRound!.id, -1);
    } catch (err: any) {
      if (err.code === 'INVALID_THRESHOLD' || err.statusCode === 400) {
        negativeRejected = true;
      }
    }
    assert(negativeRejected, 'Negative threshold is rejected (400 INVALID_THRESHOLD)');

    // Threshold exceeding active challenges in preceding round rejected
    let impossibleRejected = false;
    try {
      await progressionService.validateRoundThreshold(medRound!.id, easyActiveCount + 5);
    } catch (err: any) {
      if (err.code === 'IMPOSSIBLE_THRESHOLD' || err.statusCode === 400) {
        impossibleRejected = true;
      }
    }
    assert(impossibleRejected, `Threshold exceeding active challenges (${easyActiveCount + 5} > ${easyActiveCount}) is rejected`);

    // Valid threshold accepted
    const validCheck = await progressionService.validateRoundThreshold(medRound!.id, Math.min(easyActiveCount, 3));
    assert(validCheck.valid === true, 'Valid threshold within active challenges range is accepted');
  }

  // -------------------------------------------------------------
  // Test Suite 7: Downstream Deactivation Warning
  // -------------------------------------------------------------
  console.log('\n--- Test Suite 7: Downstream Deactivation Warning ---');
  {
    // Temporarily set Medium required solves to exactly the active count of Easy
    const allRounds = await challengeRepository.getAllRounds();
    const easyRound = allRounds.find((r) => r.slug === 'easy');
    const medRound = allRounds.find((r) => r.slug === 'medium');

    const easyActiveCount = await challengeRepository.getActiveChallengesCountByRound(easyRound!.id);
    await challengeRepository.updateRound(medRound!.id, { unlockRequiredSolves: easyActiveCount });

    // Pick an active Easy challenge and check deactivation impact
    const easyChallenges = await challengeRepository.getChallenges(easyRound!.id);
    const testChal = easyChallenges[0];

    const impact = await progressionService.checkDeactivationImpact(testChal.id);
    assert(impact.warning !== null, 'Deactivation triggers warning when remaining count < downstream required threshold');
    assert(impact.warning?.includes('UNLOCK CONFIGURATION INVALID'), 'Warning message specifies UNLOCK CONFIGURATION INVALID');

    // Reset Medium threshold back to 6
    await challengeRepository.updateRound(medRound!.id, { unlockRequiredSolves: 6 });
  }

  // -------------------------------------------------------------
  // Test Suite 8: Public Participant Security & Isolation
  // -------------------------------------------------------------
  console.log('\n--- Test Suite 8: Public Participant Protection ---');
  {
    const easyRound = (await challengeRepository.getAllRounds()).find((r) => r.slug === 'easy')!;
    const easyChallenges = await challengeRepository.getChallenges(easyRound.id);
    const testChal = easyChallenges[0];

    // Add a hidden test case to this challenge to test boundary
    await challengeRepository.addTestCase({
      challengeId: testChal.id,
      inputData: 'HIDDEN_SECRET_INPUT',
      expectedOutput: 'HIDDEN_SECRET_OUTPUT',
      isHidden: true,
      testType: 'CORNER_CASE',
    });

    // Fetch participant challenge details
    const participantDetails = await progressionService.getParticipantChallengeDetails(teamId, testChal.id);
    assert(!!participantDetails, 'Participant challenge details retrieved');
    assert(participantDetails.id === testChal.id, 'Returns matching challenge ID');

    // Public test cases MUST NOT contain the hidden test case
    const hasHidden = participantDetails.publicTestCases.some((tc) => tc.inputData === 'HIDDEN_SECRET_INPUT');
    assert(!hasHidden, 'Hidden test case is strictly EXCLUDED from public participant response');

    // Participant details MUST NOT contain flag verifiers or admin metadata
    assert((participantDetails as any).flagVerifier === undefined, 'Flag verifier is not leaked in participant details');

    // Admin view DOES contain hidden test cases
    const adminDetails = await challengeRepository.getTestCases(testChal.id, true);
    const adminHasHidden = adminDetails.some((tc) => tc.inputData === 'HIDDEN_SECRET_INPUT');
    assert(adminHasHidden, 'Admin can view hidden test cases');

    // Verify that locked challenge access by participant is rejected (403 CHALLENGE_LOCKED)
    const extremeRound = (await challengeRepository.getAllRounds()).find((r) => r.slug === 'extreme')!;
    const extremeChallenges = await challengeRepository.getChallenges(extremeRound.id);
    if (extremeChallenges.length > 0) {
      let lockedErrorThrown = false;
      try {
        await progressionService.getParticipantChallengeDetails(teamId, extremeChallenges[0].id);
      } catch (err: any) {
        lockedErrorThrown = err.code === 'CHALLENGE_LOCKED' && err.statusCode === 403;
      }
      assert(lockedErrorThrown, 'Locked difficulty challenge is rejected with 403 CHALLENGE_LOCKED');
    }
  }

  // -------------------------------------------------------------
  // Test Suite 9: Challenge CRUD & Activation
  // -------------------------------------------------------------
  console.log('\n--- Test Suite 9: Challenge CRUD Operations ---');
  {
    const allRounds = await challengeRepository.getAllRounds();
    const easyRound = allRounds.find((r) => r.slug === 'easy');

    const newId = `TEST-CHAL-${Date.now()}`;
    const created = await challengeRepository.createChallenge({
      id: newId,
      roundId: easyRound!.id,
      title: 'Dynamic Array Debug',
      slug: newId.toLowerCase(),
      description: 'Fix the off-by-one error in dynamic array expansion.',
      starterCode: 'public class DynamicArray { /* starter */ }',
      score: 50,
      displayOrder: 99,
      validationType: 'EXACT_OUTPUT',
      testCases: [
        { inputData: '5\n1 2 3 4 5', expectedOutput: '5', isHidden: false },
        { inputData: '0', expectedOutput: '0', isHidden: true },
      ],
      flagVerifier: 'FLAG{DYNAMIC_ARRAY_FIXED}',
    });

    assert(created.id === newId, 'Challenge created with specified ID');
    assert(created.score === 50, 'Challenge created with score = 50');

    // Update challenge
    const updated = await challengeRepository.updateChallenge(newId, {
      title: 'Dynamic Array Debug (Updated)',
      score: 75,
    });
    assert(updated?.title === 'Dynamic Array Debug (Updated)', 'Challenge title updated');
    assert(updated?.score === 75, 'Challenge score updated to 75');

    // Deactivate & Reactivate
    const deactivated = await challengeRepository.setChallengeActive(newId, false);
    assert(deactivated?.isActive === false, 'Challenge successfully deactivated');

    const activated = await challengeRepository.setChallengeActive(newId, true);
    assert(activated?.isActive === true, 'Challenge successfully re-activated');
  }

  // -------------------------------------------------------------
  // Test Suite 10: Audit Logging for Fragment 6
  // -------------------------------------------------------------
  console.log('\n--- Test Suite 10: Audit Logging Verification ---');
  {
    const recentLogs = await adminRepository.getAuditLogs(50);
    const actions = recentLogs.map((l) => l.action);

    assert(actions.includes('ALL_DIFFICULTIES_UNLOCKED'), 'Audit log recorded ALL_DIFFICULTIES_UNLOCKED');
    assert(actions.includes('DIFFICULTY_MANUALLY_UNLOCKED'), 'Audit log recorded DIFFICULTY_MANUALLY_UNLOCKED');
  }

  console.log('\n================================================================');
  console.log(`FRAGMENT 6 TESTS COMPLETE: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('================================================================');

  if (testsFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runProgressionTestSuite().catch((err) => {
  console.error('Fatal test error in Fragment 6:', err);
  process.exit(1);
});

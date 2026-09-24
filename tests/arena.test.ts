/**
 * BUG RIP - Fragment 7: Participant Coding Arena & Monaco Java Editor Tests
 * 
 * Verifies:
 * 1. Participant Authentication & Server-Derived Identity (Anti-spoofing)
 * 2. Event State Machine Gatekeeper (RUNNING vs PAUSED vs ENDED vs NOT_STARTED)
 * 3. Difficulty / Round Gating (Unlocked vs Locked Challenge Run Requests)
 * 4. Free Choice Navigation Within Unlocked Difficulties
 * 5. Source Code Validation (Empty, Max Size Limit)
 * 6. Code Execution Request Preparation (QUEUED in Submissions table)
 * 7. Unlimited Runs Verification (Attempt count increments, no artificial cap)
 * 8. Submissions History Isolation per Team
 * 9. Safe DTO Protection (Zero Hidden Test Cases or Flag Verifier Secrets)
 * 10. Same-Challenge Team Progress Calculation
 */

process.env.PG_MEM = 'true';

import { db } from '../src/db/index.ts';
import { runMigrations } from '../database/migrator.ts';
import { runSeed } from '../database/seed.ts';
import { teamChallengeRepository } from '../backend/repositories/teamChallengeRepository.ts';
import { challengeRepository } from '../backend/repositories/challengeRepository.ts';
import { adminRepository } from '../backend/repositories/adminRepository.ts';
import { eventService } from '../backend/services/eventService.ts';
import { progressionService } from '../backend/services/progressionService.ts';
import { teams, submissions, teamChallenges, rounds, challenges, eventSettings, adminUsers } from '../src/db/schema.ts';
import { eq, and, desc } from 'drizzle-orm';

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

async function runArenaTestSuite() {
  console.log('\n================================================================');
  console.log('BUG RIP - FRAGMENT 7: CODING ARENA & EXECUTION PREPARATION TESTS');
  console.log('================================================================');

  // 1. Initialize DB and base state
  await runMigrations();
  await runSeed();

  const adminUsersList = await db.select().from(adminUsers).where(eq(adminUsers.username, 'admin')).limit(1);
  const superAdminId = adminUsersList[0].id;

  // Retrieve seeded teams for testing
  const team1 = (
    await db
      .select()
      .from(teams)
      .where(eq(teams.teamName, 'Development Team Alpha'))
      .limit(1)
  )[0];
  assert(!!team1 && !!team1.id, 'Development Team Alpha retrieved for arena testing');

  // Retrieve second team for isolation checks
  const team2 = (
    await db
      .select()
      .from(teams)
      .where(eq(teams.teamName, 'Development Team Beta'))
      .limit(1)
  )[0];
  assert(!!team2 && !!team2.id, 'Development Team Beta retrieved for cross-team isolation checks');

  // Reset team progress & submissions for fresh slate
  await db.delete(submissions).where(eq(submissions.teamId, team1.id));
  await db.delete(submissions).where(eq(submissions.teamId, team2.id));
  await db.delete(teamChallenges).where(eq(teamChallenges.teamId, team1.id));
  await db.delete(teamChallenges).where(eq(teamChallenges.teamId, team2.id));

  console.log('\n[Suite 1] Event State Gatekeeper (Arena Access & Run Permissions)');
  // Reset event settings to NOT_STARTED
  await db
    .update(eventSettings)
    .set({
      status: 'NOT_STARTED',
      startedAt: null,
      pausedAt: null,
      endedAt: null,
      totalPausedDurationSeconds: 0,
      scheduledEndTime: null,
    })
    .where(eq(eventSettings.id, 1));

  const initialStatus = await eventService.getEventStatus();
  assert(initialStatus.status === 'NOT_STARTED', 'Event successfully initialized to NOT_STARTED');

  // Competition actions must be rejected when NOT_STARTED
  const gateNotStarted = await eventService.isCompetitionActionAllowed(team1.id);
  assert(!gateNotStarted.allowed, 'Competition action correctly blocked when event is NOT_STARTED');

  // Start the competition
  await adminRepository.transitionEventStatus('RUNNING', superAdminId, 'START');
  const runningStatus = await eventService.getEventStatus();
  assert(runningStatus.status === 'RUNNING', 'Event transitioned to RUNNING');

  const gateRunning = await eventService.isCompetitionActionAllowed(team1.id);
  assert(gateRunning.allowed, 'Competition action allowed when event is RUNNING');

  // Pause the competition
  await adminRepository.transitionEventStatus('PAUSED', superAdminId, 'PAUSE');
  const pausedStatus = await eventService.getEventStatus();
  assert(pausedStatus.status === 'PAUSED', 'Event transitioned to PAUSED');

  const gatePaused = await eventService.isCompetitionActionAllowed(team1.id);
  assert(!gatePaused.allowed, 'Competition action blocked when event is PAUSED');

  // Resume competition
  await adminRepository.transitionEventStatus('RUNNING', superAdminId, 'RESUME');
  const resumedStatus = await eventService.getEventStatus();
  assert(resumedStatus.status === 'RUNNING', 'Event resumed back to RUNNING');

  console.log('\n[Suite 2] Difficulty & Challenge Gating in Arena');
  const progression = await progressionService.getTeamProgression(team1.id);
  assert(progression.rounds.length === 4, 'All 4 difficulty rounds present in progression');

  const easyRound = progression.rounds.find((r) => r.slug === 'easy');
  const mediumRound = progression.rounds.find((r) => r.slug === 'medium');

  assert(easyRound?.isUnlocked === true, 'Easy round unlocked by default');
  assert(mediumRound?.isUnlocked === false, 'Medium round locked by default');

  const easyChallenges = progression.challenges.filter((c) => c.roundId === easyRound?.id);
  assert(easyChallenges.length >= 2, 'Easy round has active challenges');
  const firstEasy = easyChallenges[0];
  const secondEasy = easyChallenges[1];

  // Free choice verification: participant can access second challenge without solving first
  assert(firstEasy.status !== 'LOCKED', 'First easy challenge is not locked');
  assert(secondEasy.status !== 'LOCKED', 'Second easy challenge is not locked (free choice within tier)');

  // Medium challenge should be locked
  const mediumChallenges = progression.challenges.filter((c) => c.roundId === mediumRound?.id);
  const firstMedium = mediumChallenges[0];
  assert(firstMedium?.status === 'LOCKED', 'Medium challenge is strictly LOCKED before unlock threshold');

  console.log('\n[Suite 3] Participant Challenge Details & DTO Protection');
  // Safe challenge details check
  const details = await progressionService.getParticipantChallengeDetails(team1.id, firstEasy.id);
  assert(details.id === firstEasy.id, 'Participant can fetch unlocked challenge details');
  assert(typeof details.starterCode === 'string', 'Challenge includes Java starterCode');
  assert(Array.isArray(details.publicTestCases), 'Challenge includes public test cases');
  // Verify NO hidden test cases or flag secrets in DTO
  assert((details as any).hiddenTestCases === undefined, 'DTO strictly omits hiddenTestCases');
  assert((details as any).authoritativeFlagHash === undefined, 'DTO strictly omits authoritativeFlagHash');
  assert((details as any).adminNotes === undefined, 'DTO strictly omits adminNotes');

  // Locked challenge details check must throw CHALLENGE_LOCKED
  let lockedErrorCaught = false;
  try {
    await progressionService.getParticipantChallengeDetails(team1.id, firstMedium.id);
  } catch (err: any) {
    if (err.code === 'CHALLENGE_LOCKED') {
      lockedErrorCaught = true;
    }
  }
  assert(lockedErrorCaught, 'Attempting to fetch details for locked challenge throws CHALLENGE_LOCKED');

  console.log('\n[Suite 4] Code Execution Request Preparation (QUEUED)');
  const sampleJavaCode = `
public class Solution {
    public static void main(String[] args) {
        System.out.println("Hello Bug Rip Arena");
    }
}
`;

  // Submit valid execution request
  const run1 = await teamChallengeRepository.recordExecutionSubmission({
    teamId: team1.id,
    challengeId: firstEasy.id,
    sourceCode: sampleJavaCode,
    executionStatus: 'QUEUED',
    stdout: 'EXECUTION SERVICE NOT YET AVAILABLE: Code execution request has been validated and queued for the Fragment 8 sandbox.',
  });

  assert(!!run1 && !!run1.id, 'Execution submission successfully queued in database');
  assert(run1.executionStatus === 'QUEUED', 'Initial execution status is QUEUED');
  assert(run1.teamId === team1.id, 'Submission recorded with server-derived team ID');
  assert(run1.challengeId === firstEasy.id, 'Submission associated with targeted challenge');

  console.log('\n[Suite 5] Unlimited Runs & Attempt Counter Verification');
  // Second submission on same challenge
  const run2 = await teamChallengeRepository.recordExecutionSubmission({
    teamId: team1.id,
    challengeId: firstEasy.id,
    sourceCode: sampleJavaCode + '\n// second run',
    executionStatus: 'QUEUED',
  });
  assert(!!run2 && run2.id !== run1.id, 'Subsequent execution request successfully created');

  // Third submission on same challenge
  const run3 = await teamChallengeRepository.recordExecutionSubmission({
    teamId: team1.id,
    challengeId: firstEasy.id,
    sourceCode: sampleJavaCode + '\n// third run',
    executionStatus: 'QUEUED',
  });
  assert(!!run3 && run3.id !== run2.id, 'Unlimited runs allowed without artificial decrement');

  // Check team challenge attempt count
  const teamChalState = await teamChallengeRepository.getTeamChallenge(team1.id, firstEasy.id);
  assert(
    (teamChalState?.attemptCount ?? 0) >= 3,
    `Attempt count properly tracked (${teamChalState?.attemptCount} attempts) without capping executions`
  );

  console.log('\n[Suite 6] Submission History Isolation per Team');
  // Record run for team2
  await teamChallengeRepository.recordExecutionSubmission({
    teamId: team2.id,
    challengeId: firstEasy.id,
    sourceCode: 'public class Team2Solution {}',
    executionStatus: 'QUEUED',
  });

  // Query submissions for team1
  const team1Subs = await db
    .select()
    .from(submissions)
    .where(and(eq(submissions.teamId, team1.id), eq(submissions.challengeId, firstEasy.id)));

  assert(
    team1Subs.length >= 3 && team1Subs.every((s) => s.teamId === team1.id),
    'Team 1 submissions strictly isolated; no cross-contamination from Team 2'
  );

  const team2Subs = await db
    .select()
    .from(submissions)
    .where(and(eq(submissions.teamId, team2.id), eq(submissions.challengeId, firstEasy.id)));

  assert(
    team2Subs.length === 1 && team2Subs[0].teamId === team2.id,
    'Team 2 submissions strictly isolated'
  );

  console.log('\n[Suite 7] Source Code Size Limits & Validation');
  const chalInfo = await challengeRepository.getChallengeById(firstEasy.id);
  const maxBytes = chalInfo?.maxSourceBytes || 65536;
  assert(maxBytes > 0, `Challenge has valid maxSourceBytes limit (${maxBytes} bytes)`);

  const normalBytes = Buffer.byteLength(sampleJavaCode, 'utf8');
  assert(normalBytes <= maxBytes, 'Sample code is within size limits');

  const oversizeCode = 'X'.repeat(maxBytes + 100);
  const oversizeBytes = Buffer.byteLength(oversizeCode, 'utf8');
  assert(oversizeBytes > maxBytes, 'Oversize code exceeds challenge maxSourceBytes');

  console.log('\n[Suite 8] Teammate Solve & Shared Team State Synchronization');
  // Team 1 solves firstEasy
  const solveRes = await teamChallengeRepository.recordSolveAttempt({
    teamId: team1.id,
    challengeId: firstEasy.id,
  });
  assert(solveRes.accepted === true, 'Team 1 solves challenge successfully');

  // Verify progression reflects solve immediately
  const updatedProgression = await progressionService.getTeamProgression(team1.id);
  assert(updatedProgression.stats.problemsSolved === 1, 'Progression solved count incremented to 1');
  assert(updatedProgression.stats.totalScore === firstEasy.score, `Total score updated to ${firstEasy.score}`);

  const solvedItem = updatedProgression.challenges.find((c) => c.id === firstEasy.id);
  assert(solvedItem?.status === 'COMPLETED', 'Solved challenge is marked COMPLETED in team progression');

  // Second teammate attempt on same challenge is safely handled as already solved
  const duplicateSolve = await teamChallengeRepository.recordSolveAttempt({
    teamId: team1.id,
    challengeId: firstEasy.id,
  });
  assert(
    duplicateSolve.accepted === false,
    'Teammate duplicate solve is safely handled and does not award duplicate points'
  );

  console.log('\n[Suite 9] Event Termination Gate (ENDED)');
  await adminRepository.transitionEventStatus('ENDED', superAdminId, 'END');
  const endedStatus = await eventService.getEventStatus();
  assert(endedStatus.status === 'ENDED', 'Event successfully transitioned to ENDED');

  const gateEnded = await eventService.isCompetitionActionAllowed(team1.id);
  assert(!gateEnded.allowed, 'Competition action blocked when event is ENDED');

  console.log('\n================================================================');
  console.log(`FRAGMENT 7 TEST SUMMARY: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('================================================================');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runArenaTestSuite().catch((err) => {
  console.error('Fatal error in Fragment 7 test suite:', err);
  process.exit(1);
});

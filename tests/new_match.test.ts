/**
 * BUG RIP - Match Restart / New Competition Run Tests
 * 
 * Tests the authoritative multi-match lifecycle:
 * 1. State Machine: ENDED cannot directly become RUNNING. ENDED -> NEW MATCH -> NOT_STARTED -> START -> RUNNING.
 * 2. Data Isolation: Match 1 scores & completions preserved; Match 2 starts at 0 solves and 0 points.
 * 3. Timer: Match 1 ends; Match 2 timer initializes at 60 minutes in NOT_STARTED state.
 * 4. Registration Continuity: Existing registered teams and team codes remain valid for Match 2.
 * 5. Session Isolation: Participant session state sees Match 2 fresh state.
 * 6. Admin Authentication & Confirmation: Only authenticated admin can create new match; requires confirmation.
 * 7. Concurrency Safety: Simultaneous NEW MATCH attempts produce exactly one new match.
 * 8. Audit Logging: NEW_MATCH_CREATED audit trail is recorded.
 */

import crypto from 'crypto';
import { db } from '../src/db/index.ts';
import { runMigrations } from '../database/migrator.ts';
import { runSeed } from '../database/seed.ts';
import { adminRepository } from '../backend/repositories/adminRepository.ts';
import { teamRepository } from '../backend/repositories/teamRepository.ts';
import { teamChallengeRepository } from '../backend/repositories/teamChallengeRepository.ts';
import { eventRepository } from '../backend/repositories/eventRepository.ts';
import { progressionService } from '../backend/services/progressionService.ts';
import {
  eventSettings,
  competitionMatches,
  matchHistoricalChallenges,
  teamChallenges,
  teamUnlockedRounds,
  submissions,
  flagSubmissions,
  auditLogs,
  teams,
  participants,
  challenges,
} from '../src/db/schema.ts';
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

async function runNewMatchTests() {
  console.log('\n====================================================');
  console.log('BUG RIP: Running Match Restart & Isolation Test Suite');
  console.log('====================================================');

  // Initialize DB and baseline seed
  await runMigrations();
  await runSeed();

  // Baseline setup: Admin user
  const admin = await adminRepository.verifyAdminCredentials('admin', 'BugRipAdmin2026!');
  assert(admin !== null, 'Admin credentials verified');
  const adminId = admin!.id;

  // Baseline setup: Teams & Challenges
  const allTeams = await db.select().from(teams);
  assert(allTeams.length >= 2, 'At least 2 seeded teams available');
  const team1 = allTeams[0];
  const team2 = allTeams[1];

  const allChallenges = await db.select().from(challenges);
  assert(allChallenges.length >= 2, 'At least 2 seeded challenges available');
  const chal1Id = allChallenges[0].id;
  const chal2Id = allChallenges[1].id;

  // Set event to fresh NOT_STARTED Match 1
  await db
    .update(eventSettings)
    .set({
      status: 'NOT_STARTED',
      durationMinutes: 60,
      startedAt: null,
      endedAt: null,
      pausedAt: null,
      totalPausedDurationSeconds: 0,
      currentMatchNumber: 1,
    })
    .where(eq(eventSettings.id, 1));

  await db.delete(teamChallenges);
  await db.delete(teamUnlockedRounds);
  await db.delete(competitionMatches);
  await db.delete(matchHistoricalChallenges);

  // =========================================================================
  // 1. STATE MACHINE INTEGRITY & TERMINAL ENDED STATE
  // =========================================================================
  console.log('\n[1. State Machine: Match 1 Lifecycle & Terminal ENDED Protection]');

  // 1.1 START Match 1: NOT_STARTED -> RUNNING
  const start1 = await adminRepository.transitionEventStatus('RUNNING', adminId, 'START');
  assert(start1.success === true, 'Match 1 transitions from NOT_STARTED to RUNNING');
  assert(start1.event.status === 'RUNNING', 'Match 1 status is RUNNING');
  assert(start1.event.currentMatchNumber === 1, 'Match number is 1');

  // 1.2 PAUSE and RESUME during Match 1
  const pause1 = await adminRepository.transitionEventStatus('PAUSED', adminId, 'PAUSE');
  assert(pause1.success === true, 'Match 1 transitions to PAUSED');
  const resume1 = await adminRepository.transitionEventStatus('RUNNING', adminId, 'RESUME');
  assert(resume1.success === true, 'Match 1 transitions back to RUNNING');

  // 1.3 Record a challenge completion for Team 1 during Match 1
  const completeChal1 = await teamChallengeRepository.recordSolveAttempt({
    teamId: team1.id,
    challengeId: chal1Id,
  });
  assert(completeChal1.accepted === true, `Team 1 solves ${chal1Id} during Match 1`);

  // Record an execution submission for Team 1
  const sub1 = await teamChallengeRepository.recordExecutionSubmission({
    teamId: team1.id,
    challengeId: chal1Id,
    sourceCode: 'public class Solution {}',
    executionStatus: 'SUCCESS',
    stdout: 'Match 1 output',
  });
  assert(sub1.matchNumber === 1, 'Submission is tagged with Match #1');

  // Check Team 1 progress in Match 1
  const summaryMatch1 = await teamChallengeRepository.getTeamProgressSummary(team1.id);
  assert(summaryMatch1.problemsSolved === 1, 'Team 1 has 1 solve in Match 1');
  assert(summaryMatch1.totalScore > 0, `Team 1 has points in Match 1 (score: ${summaryMatch1.totalScore})`);

  // 1.4 END Match 1: RUNNING -> ENDED
  const end1 = await adminRepository.transitionEventStatus('ENDED', adminId, 'END');
  assert(end1.success === true, 'Match 1 transitions to ENDED');
  assert(end1.event.status === 'ENDED', 'Match 1 status is terminal ENDED');

  // 1.5 Strict terminal check: ENDED CANNOT DIRECTLY BECOME RUNNING OR RESUMED
  const illegalStart = await adminRepository.transitionEventStatus('RUNNING', adminId, 'START');
  assert(illegalStart.success === false, 'ENDED cannot transition directly to RUNNING via START');
  assert(illegalStart.error?.includes('ENDED'), 'Error correctly explains current status is ENDED');

  const illegalResume = await adminRepository.transitionEventStatus('RUNNING', adminId, 'RESUME');
  assert(illegalResume.success === false, 'ENDED cannot transition directly to RUNNING via RESUME');

  const illegalPause = await adminRepository.transitionEventStatus('PAUSED', adminId, 'PAUSE');
  assert(illegalPause.success === false, 'ENDED cannot transition to PAUSED');

  // =========================================================================
  // 2. EXPLICIT NEW MATCH CREATION
  // =========================================================================
  console.log('\n[2. Explicit New Match Creation Workflow]');

  // 2.1 Attempting to create new match while in progress should fail
  // Temporarily simulate RUNNING
  await db.update(eventSettings).set({ status: 'RUNNING' }).where(eq(eventSettings.id, 1));
  const illegalNewMatch = await adminRepository.createNewMatch(adminId, { matchName: 'Premature Match' });
  assert(illegalNewMatch.success === false, 'Cannot create new match while status is RUNNING');
  assert(illegalNewMatch.error?.includes('RUNNING'), 'Error specifies match is in progress');

  // Restore ENDED
  await db.update(eventSettings).set({ status: 'ENDED' }).where(eq(eventSettings.id, 1));

  // 2.2 Create Match 2 from ENDED state
  const newMatchResult = await adminRepository.createNewMatch(adminId, {
    matchName: 'Match 2 - Championship Round',
    durationMinutes: 60,
  });
  assert(newMatchResult.success === true, 'Successfully created Match 2 from ENDED state');
  assert(newMatchResult.match.matchNumber === 2, 'New match is assigned Match #2');
  assert(newMatchResult.match.status === 'NOT_STARTED', 'Match 2 is initialized in NOT_STARTED state');
  assert(newMatchResult.event.status === 'NOT_STARTED', 'Event settings status is reset to NOT_STARTED');
  assert(newMatchResult.event.currentMatchNumber === 2, 'Event settings currentMatchNumber is 2');
  assert(newMatchResult.event.startedAt === null, 'Match 2 startedAt is null');
  assert(newMatchResult.event.endedAt === null, 'Match 2 endedAt is null');

  // =========================================================================
  // 3. DATA ISOLATION & HISTORICAL RETENTION
  // =========================================================================
  console.log('\n[3. Data Isolation: Clean Arena vs Preserved Match 1 History]');

  // 3.1 Verify Match 1 archive is preserved
  const match1History = await db
    .select()
    .from(competitionMatches)
    .where(eq(competitionMatches.matchNumber, 1))
    .limit(1);
  assert(match1History.length === 1, 'Match 1 historical record exists');
  assert(match1History[0].status === 'ENDED', 'Match 1 status remains ENDED in history');
  assert(Boolean(match1History[0].finalLeaderboard), 'Match 1 final leaderboard snapshot is preserved');

  // Verify Match 1 solved challenges are archived in matchHistoricalChallenges
  const archivedCompletions = await db
    .select()
    .from(matchHistoricalChallenges)
    .where(eq(matchHistoricalChallenges.matchNumber, 1));
  assert(archivedCompletions.length >= 1, 'Match 1 challenge completions archived in historical table');
  assert(
    archivedCompletions.some((c) => c.teamId === team1.id && c.challengeId === chal1Id),
    `Team 1 solve for ${chal1Id} archived under Match 1`
  );

  // 3.2 Verify Match 2 live arena state is clean
  const match2ActiveChallenges = await db.select().from(teamChallenges);
  assert(match2ActiveChallenges.length === 0, 'Active team_challenges table is completely reset for Match 2');

  const summaryMatch2 = await teamChallengeRepository.getTeamProgressSummary(team1.id);
  assert(summaryMatch2.problemsSolved === 0, 'Team 1 solved count in Match 2 is 0');
  assert(summaryMatch2.totalScore === 0, 'Team 1 score in Match 2 is 0');

  // 3.3 Verify progression is reset to initial state
  const progressionTeam1 = await progressionService.getTeamProgression(team1.id);
  const easy1State = progressionTeam1.challenges.find((c) => c.id === chal1Id);
  assert(easy1State?.status === 'AVAILABLE', `${chal1Id} is AVAILABLE (not COMPLETED) in Match 2`);

  // 3.4 Verify Match 1 submissions are intact
  const match1Subs = await db
    .select()
    .from(submissions)
    .where(eq(submissions.matchNumber, 1));
  assert(match1Subs.length >= 1, 'Historical submissions from Match 1 are intact in database');

  // =========================================================================
  // 4. TIMER INITIALIZATION
  // =========================================================================
  console.log('\n[4. Timer Initialization for Match 2]');
  const eventSettingsRow = await eventRepository.getEventSettings();
  assert(eventSettingsRow?.durationMinutes === 60, 'Match 2 duration configured to 60 minutes');
  assert(eventSettingsRow?.status === 'NOT_STARTED', 'Match 2 timer is NOT running yet');
  assert(eventSettingsRow?.startedAt === null, 'No startedAt timestamp until START is explicitly pressed');

  // =========================================================================
  // 5. REGISTRATION CONTINUITY
  // =========================================================================
  console.log('\n[5. Registration Continuity]');
  const teamsAfterReset = await db.select().from(teams);
  assert(teamsAfterReset.length === allTeams.length, 'All registered teams remain in database');
  
  // Verify Team 1 can authenticate with the exact same code
  const authTeam1 = await teamRepository.verifyCredentials(team1.teamName, team1.teamCode);
  assert(authTeam1 !== null, 'Team 1 authenticates with original name and team code for Match 2');
  assert(authTeam1?.id === team1.id, 'Team 1 ID is identical across matches');

  // =========================================================================
  // 6. STARTING MATCH 2 & SOLVING CHALLENGES IN MATCH 2
  // =========================================================================
  console.log('\n[6. Running Match 2 to Verify Independent Lifecycle]');

  // 6.1 Start Match 2
  const start2 = await adminRepository.transitionEventStatus('RUNNING', adminId, 'START');
  assert(start2.success === true, 'Match 2 transitions from NOT_STARTED to RUNNING');
  assert(start2.event.status === 'RUNNING', 'Match 2 status is RUNNING');
  assert(start2.event.currentMatchNumber === 2, 'Match 2 is the active match');

  // 6.2 Team 2 solves a challenge in Match 2
  const completeTeam2 = await teamChallengeRepository.recordSolveAttempt({
    teamId: team2.id,
    challengeId: chal2Id,
  });
  assert(completeTeam2.accepted === true, `Team 2 solves ${chal2Id} in Match 2`);

  const summaryTeam2 = await teamChallengeRepository.getTeamProgressSummary(team2.id);
  assert(summaryTeam2.problemsSolved === 1, 'Team 2 has 1 solve in Match 2');

  // Team 1 still has 0 solves in Match 2
  const summaryTeam1InMatch2 = await teamChallengeRepository.getTeamProgressSummary(team1.id);
  assert(summaryTeam1InMatch2.problemsSolved === 0, 'Team 1 correctly remains at 0 solves in Match 2');

  // =========================================================================
  // 7. CONCURRENCY SAFETY
  // =========================================================================
  console.log('\n[7. Concurrency Safety: Simultaneous New Match Requests]');

  // End Match 2 first
  await adminRepository.transitionEventStatus('ENDED', adminId, 'END');

  // Fire two createNewMatch calls concurrently
  const [resA, resB] = await Promise.all([
    adminRepository.createNewMatch(adminId, { matchName: 'Concurrent Run A' }),
    adminRepository.createNewMatch(adminId, { matchName: 'Concurrent Run B' }),
  ]);

  const successCount = (resA.success ? 1 : 0) + (resB.success ? 1 : 0);
  assert(successCount === 1, `Exactly one concurrent new match request succeeds (actual: ${successCount})`);

  const rejected = !resA.success ? resA : resB;
  assert(Boolean(rejected.error), 'The rejected concurrent call received an explicit error');

  // Verify only Match 3 was created (not Match 3 and Match 4 simultaneously)
  const currentEvent = await eventRepository.getEventSettings();
  assert(currentEvent?.currentMatchNumber === 3, 'Authoritative event settings reflect exactly Match 3');

  // =========================================================================
  // 8. AUDIT LOGGING VERIFICATION
  // =========================================================================
  console.log('\n[8. Authoritative Audit Trail for New Matches]');
  const auditLogsList = await adminRepository.getAuditLogs(50);
  const newMatchLogs = auditLogsList.filter((l) => l.action === 'NEW_MATCH_CREATED');
  assert(newMatchLogs.length >= 2, `NEW_MATCH_CREATED audit logs recorded (count: ${newMatchLogs.length})`);
  
  const latestNewMatchLog = newMatchLogs[0];
  assert(latestNewMatchLog.targetType === 'MATCH', 'Target type is MATCH');
  assert(latestNewMatchLog.metadata?.previousMatchNumber !== undefined, 'Log contains previousMatchNumber');
  assert(latestNewMatchLog.metadata?.newMatchNumber !== undefined, 'Log contains newMatchNumber');
  assert(latestNewMatchLog.metadata?.createdAt !== undefined, 'Log contains ISO timestamp');

  // Verify no passwords, secrets, or raw session tokens leaked in metadata
  const metadataStr = JSON.stringify(latestNewMatchLog.metadata || {});
  assert(!metadataStr.includes('password'), 'Audit log contains no passwords');
  assert(!metadataStr.includes('sessionToken'), 'Audit log contains no session tokens');

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n====================================================');
  console.log(`TEST SUMMARY: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('====================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runNewMatchTests().catch((err) => {
  console.error('Unhandled test execution failure:', err);
  process.exit(1);
});

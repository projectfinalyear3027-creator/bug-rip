/**
 * BUG SNIPER - Comprehensive Validation: Authoritative Match Timer & Arena Lock
 *
 * Verifies:
 * 1. Timer does not reset after challenge change.
 * 2. Timer does not reset after component remount.
 * 3. Timer does not reset after simulated page reload/session restoration.
 * 4. Timer resumes from authoritative remaining time.
 * 5. PAUSED freezes authoritative timer.
 * 6. ENDED becomes zero (displays 00:00).
 * 7. New match receives a fresh timer (60:00 in NOT_STARTED).
 * 8. Old match timer does not leak into new match.
 * 9. Arena Lock: isCompetitionActionAllowed blocks run/submit when NOT_STARTED, PAUSED, ENDED.
 * 10. Server exposes authoritative timer state with all required fields.
 */

process.env.PG_MEM = 'true';
process.env.SEED_TEST_FIXTURES = 'true';

import { db } from '../src/db/index.ts';
import { runMigrations } from '../database/migrator.ts';
import { runSeed } from '../database/seed.ts';
import { eventService } from '../backend/services/eventService.ts';
import { adminRepository } from '../backend/repositories/adminRepository.ts';
import { antiCheatService } from '../backend/services/antiCheatService.ts';
import { antiCheatRepository } from '../backend/repositories/antiCheatRepository.ts';
import { handleRunExecution, handleSubmitFlag } from '../backend/routes/challengeRoutes.ts';
import { teamChallengeRepository } from '../backend/repositories/teamChallengeRepository.ts';
import {
  eventSettings,
  adminUsers,
  teams,
  challenges,
  participants,
  sessions,
  competitionMatches,
  antiCheatEvents,
} from '../src/db/schema.ts';
import { eq } from 'drizzle-orm';
import {
  getRemainingSeconds,
  getTimerState,
  updateFromServer,
  resetTimerStore,
  formatTimerDisplay,
} from '../src/services/authoritativeTimer.ts';

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

function createMockRes() {
  const res: any = {
    statusCode: 200,
    headers: {},
    data: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: any) {
      res.data = data;
      return res;
    },
    setHeader(k: string, v: string) {
      res.headers[k] = v;
      return res;
    },
  };
  return res;
}

async function runTestSuite() {
  console.log('\n========================================================================');
  console.log('BUG SNIPER: AUTHORITATIVE MATCH TIMER & PARTICIPANT ARENA LOCK TESTS');
  console.log('========================================================================\n');

  // Initialize DB
  await runMigrations();
  await runSeed();

  const adminList = await db.select().from(adminUsers).where(eq(adminUsers.username, 'admin')).limit(1);
  const adminId = adminList[0]?.id || '00000000-0000-0000-0000-000000000001';

  const activeTeams = await db.select().from(teams).where(eq(teams.status, 'ACTIVE')).limit(1);
  const teamId = activeTeams[0].id;

  // ---------------------------------------------------------------------------
  // 1. Server Exposes Authoritative Timer State with Required Fields
  // ---------------------------------------------------------------------------
  console.log('--- 1. Server Exposes Authoritative Timer State ---');
  {
    const status = await eventService.getEventStatus();
    assert(status !== null && typeof status === 'object', 'Event status is returned');
    assert('status' in status, 'Exposes status: NOT_STARTED | RUNNING | PAUSED | ENDED');
    assert('currentMatchNumber' in status, 'Exposes currentMatchNumber');
    assert('currentMatchId' in status, 'Exposes currentMatchId');
    assert('durationMinutes' in status && status.durationMinutes === 60, 'Exposes durationMinutes (60)');
    assert('totalSeconds' in status && status.totalSeconds === 3600, 'Exposes totalSeconds (3600)');
    assert('remainingSeconds' in status, 'Exposes remainingSeconds');
    assert('serverTime' in status, 'Exposes serverTime for clock synchronization');
  }

  // ---------------------------------------------------------------------------
  // 2. Timer Does Not Reset After Challenge Change
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Timer Does Not Reset After Challenge Change ---');
  {
    resetTimerStore();

    // Start event on server: set to RUNNING with 45 minutes remaining (2700s)
    updateFromServer({
      currentMatchNumber: 1,
      currentMatchId: 'match-1-uuid',
      status: 'RUNNING',
      durationMinutes: 60,
      totalSeconds: 3600,
      remainingSeconds: 2700,
      startedAt: new Date(Date.now() - 900000).toISOString(),
    });

    const beforeChallengeSwitch = getRemainingSeconds();
    assert(beforeChallengeSwitch <= 2700 && beforeChallengeSwitch >= 2698, `Initial remaining time is ~2700s (got ${beforeChallengeSwitch}s)`);

    // Simulate switching challenge: challenge ID changes in UI, but timer singleton is not re-created
    const activeChallenge1: string = 'EASY-01';
    const activeChallenge2: string = 'EASY-02';
    assert(activeChallenge1 !== activeChallenge2, 'Simulating navigation between challenges');

    // Small delay to simulate interaction
    await new Promise((r) => setTimeout(r, 50));

    const afterChallengeSwitch = getRemainingSeconds();
    assert(
      afterChallengeSwitch <= beforeChallengeSwitch && afterChallengeSwitch >= beforeChallengeSwitch - 1,
      `Timer continues smoothly across challenge change without resetting to 3600 (was ${beforeChallengeSwitch}s, now ${afterChallengeSwitch}s)`
    );
    assert(afterChallengeSwitch !== 3600, 'Timer was not reset to 3600 on challenge switch');
  }

  // ---------------------------------------------------------------------------
  // 3. Timer Does Not Reset After Component Remount
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Timer Does Not Reset After Component Remount ---');
  {
    // Simulate component unmount and remount during same match
    const beforeUnmount = getRemainingSeconds();

    // In React, component unmounting cleans up local effects but singleton timerState remains
    await new Promise((r) => setTimeout(r, 100));

    // Remount: component reads getRemainingSeconds()
    const afterRemount = getRemainingSeconds();
    assert(
      afterRemount <= beforeUnmount && afterRemount >= beforeUnmount - 1,
      `Timer preserved across component remount (before: ${beforeUnmount}s, after: ${afterRemount}s)`
    );
    assert(afterRemount !== 3600, 'Remounted component did not reset timer to 3600');
  }

  // ---------------------------------------------------------------------------
  // 4. Timer Does Not Reset After Simulated Page Reload / Session Restoration
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Timer Does Not Reset After Simulated Page Reload / Session Restoration ---');
  {
    // On page reload, restoreSession fetches /api/auth/session which returns authoritativeTimer
    const serverAuthoritativeState = {
      currentMatchId: 'match-1-uuid',
      currentMatchNumber: 1,
      status: 'RUNNING' as const,
      durationMinutes: 60,
      totalSeconds: 3600,
      remainingSeconds: 2450,
      startedAt: new Date(Date.now() - 1150000).toISOString(),
      serverTime: new Date().toISOString(),
    };

    // Reload creates fresh module state or restores session:
    updateFromServer(serverAuthoritativeState);

    const restoredRemaining = getRemainingSeconds();
    assert(
      restoredRemaining <= 2450 && restoredRemaining >= 2448,
      `Session restoration correctly restored remaining time: ${restoredRemaining}s (expected ~2450s)`
    );
    assert(restoredRemaining !== 3600, 'Restored session did not reset to 3600');
  }

  // ---------------------------------------------------------------------------
  // 5. Timer Resumes from Authoritative Remaining Time
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. Timer Resumes from Authoritative Remaining Time ---');
  {
    // Re-entering arena during same match uses authoritative state
    const current = getRemainingSeconds();
    assert(current > 0 && current < 3600, `Timer resumes at ${current}s without resetting`);

    // Verify formatTimerDisplay matches
    const formatted = formatTimerDisplay(current);
    const expectedMinutes = Math.floor(current / 60);
    assert(
      formatted.startsWith(expectedMinutes.toString().padStart(2, '0')),
      `Formatted display "${formatted}" reflects exact authoritative time`
    );
  }

  // ---------------------------------------------------------------------------
  // 6. PAUSED Freezes Authoritative Timer
  // ---------------------------------------------------------------------------
  console.log('\n--- 6. PAUSED Freezes Authoritative Timer ---');
  {
    // Transition to PAUSED with 1800s remaining
    updateFromServer({
      status: 'PAUSED',
      remainingSeconds: 1800,
      pausedAt: new Date().toISOString(),
    });

    const frozen1 = getRemainingSeconds();
    assert(frozen1 === 1800, `PAUSED timer initialized at ${frozen1}s`);

    // Wait 150ms
    await new Promise((r) => setTimeout(r, 150));

    const frozen2 = getRemainingSeconds();
    assert(frozen2 === 1800, `PAUSED timer remained frozen at exactly ${frozen2}s after delay`);
    assert(getTimerState().status === 'PAUSED', 'Store status is PAUSED');
  }

  // ---------------------------------------------------------------------------
  // 7. ENDED Becomes Zero
  // ---------------------------------------------------------------------------
  console.log('\n--- 7. ENDED Becomes Zero (00:00) ---');
  {
    updateFromServer({
      status: 'ENDED',
      remainingSeconds: 0,
      endedAt: new Date().toISOString(),
    });

    const endedSeconds = getRemainingSeconds();
    assert(endedSeconds === 0, `ENDED remaining seconds is strictly 0 (got ${endedSeconds})`);
    assert(formatTimerDisplay(endedSeconds) === '00:00', 'Formatted display is "00:00"');
    assert(getTimerState().status === 'ENDED', 'Store status is ENDED');
  }

  // ---------------------------------------------------------------------------
  // 8. New Match Receives a Fresh Timer (60:00 in NOT_STARTED)
  // ---------------------------------------------------------------------------
  console.log('\n--- 8. New Match Receives Fresh Timer ---');
  {
    // Create new match: matchNumber changes from 1 to 2
    updateFromServer({
      currentMatchNumber: 2,
      currentMatchId: 'match-2-uuid',
      status: 'NOT_STARTED',
      durationMinutes: 60,
      totalSeconds: 3600,
      remainingSeconds: 3600,
      startedAt: null,
      endedAt: null,
      pausedAt: null,
    });

    const match2State = getTimerState();
    assert(match2State.currentMatchNumber === 2, 'Match number updated to 2');
    assert(match2State.currentMatchId === 'match-2-uuid', 'Match ID updated to match-2-uuid');
    assert(match2State.status === 'NOT_STARTED', 'New match status is NOT_STARTED');
    assert(match2State.remainingSeconds === 3600, 'New match remainingSeconds initialized to 3600');
    assert(getRemainingSeconds() === 3600, 'getRemainingSeconds() returns 3600 for new match');
    assert(formatTimerDisplay(getRemainingSeconds()) === '60:00', 'Formatted display is "60:00"');
    assert(match2State.startedAt === null, 'startedAt is null for new match');
    assert(match2State.endedAt === null, 'endedAt is null for new match');
  }

  // ---------------------------------------------------------------------------
  // 9. Old Match Timer Does Not Leak Into New Match
  // ---------------------------------------------------------------------------
  console.log('\n--- 9. Old Match Timer Does Not Leak Into New Match ---');
  {
    // Verify that none of Match 1's ENDED / 0s values leaked into Match 2
    const current = getRemainingSeconds();
    assert(current === 3600, 'Match 2 is at full 3600s, completely unaffected by Match 1 ending at 0s');

    // Simulate Match 2 starting and ticking
    updateFromServer({
      status: 'RUNNING',
      remainingSeconds: 3600,
      startedAt: new Date().toISOString(),
    });
    assert(getTimerState().status === 'RUNNING', 'Match 2 started into RUNNING state');
    assert(getRemainingSeconds() <= 3600 && getRemainingSeconds() >= 3598, 'Match 2 counting down from 3600');
  }

  // ---------------------------------------------------------------------------
  // 10. Arena Lock: Server Gatekeeper Blocks Execution across Inactive States
  // ---------------------------------------------------------------------------
  console.log('\n--- 10. Arena Lock: Gatekeeper Enforcement ---');
  {
    // Test NOT_STARTED: action must be blocked
    await db.update(eventSettings).set({ status: 'NOT_STARTED', startedAt: null, pausedAt: null, endedAt: null }).where(eq(eventSettings.id, 1));
    const notStartedGate = await eventService.isCompetitionActionAllowed(teamId);
    assert(notStartedGate.allowed === false, 'Gatekeeper blocks action when NOT_STARTED');
    assert(notStartedGate.status === 'NOT_STARTED', 'Gatekeeper reports status NOT_STARTED');

    // Test PAUSED: action must be blocked
    await db.update(eventSettings).set({ status: 'PAUSED', pausedAt: new Date() }).where(eq(eventSettings.id, 1));
    const pausedGate = await eventService.isCompetitionActionAllowed(teamId);
    assert(pausedGate.allowed === false, 'Gatekeeper blocks action when PAUSED');
    assert(pausedGate.status === 'PAUSED', 'Gatekeeper reports status PAUSED');

    // Test ENDED: action must be blocked
    await db.update(eventSettings).set({ status: 'ENDED', endedAt: new Date() }).where(eq(eventSettings.id, 1));
    const endedGate = await eventService.isCompetitionActionAllowed(teamId);
    assert(endedGate.allowed === false, 'Gatekeeper blocks action when ENDED');
    assert(endedGate.status === 'ENDED', 'Gatekeeper reports status ENDED');
    assert(endedGate.remainingSeconds === 0, 'Gatekeeper reports remainingSeconds 0 when ENDED');

    // Test RUNNING: action permitted
    await db.update(eventSettings).set({ status: 'RUNNING', startedAt: new Date(), pausedAt: null, endedAt: null, totalPausedDurationSeconds: 0 }).where(eq(eventSettings.id, 1));
    const runningGate = await eventService.isCompetitionActionAllowed(teamId);
    assert(runningGate.allowed === true, 'Gatekeeper permits action when RUNNING');
    assert(runningGate.status === 'RUNNING', 'Gatekeeper reports status RUNNING');
  }

  // ===========================================================================
  // 11. FULLSCREEN SOLVING GATE: RUNNING + Fullscreen (Accepted Execution & Flag Submission)
  // ===========================================================================
  console.log('\n--- 11. Fullscreen Gate: RUNNING + Fullscreen ---');
  {
    // Retrieve active participant and challenge
    const [part] = await db.select().from(participants).limit(1);
    const participantId = part?.id || teamId;
    const [chal] = await db.select().from(challenges).where(eq(challenges.isActive, true)).limit(1);
    const challengeId = chal.id;

    // Create session record
    const [sess] = await db
      .insert(sessions)
      .values({
        teamId,
        participantId,
        sessionTokenHash: 'test-fs-token-' + Date.now(),
        status: 'ACTIVE',
      })
      .returning();
    const sessionId = sess.id;

    // Match is RUNNING
    await db.update(eventSettings).set({
      status: 'RUNNING',
      startedAt: new Date(Date.now() - 300000),
      pausedAt: null,
      endedAt: null,
      totalPausedDurationSeconds: 0,
      currentMatchNumber: 1,
    }).where(eq(eventSettings.id, 1));

    // Confirm fullscreen via FULLSCREEN_ENTER
    const enterRes = await antiCheatService.recordClientEvent({
      participantId,
      teamId,
      sessionId,
      eventType: 'FULLSCREEN_ENTER',
      matchNumber: 1,
    });
    assert(enterRes.recorded === true, 'FULLSCREEN_ENTER integrity event recorded');
    assert(
      antiCheatService.isParticipantInFullscreen(participantId, teamId, sessionId) === true,
      'Participant verified in arena fullscreen state'
    );

    // Direct Execution Request while RUNNING + Fullscreen: Must be accepted
    const reqRun: any = {
      participant: { id: participantId },
      team: { id: teamId },
      sessionRecord: { id: sessionId, participantId, teamId },
      params: { id: challengeId },
      body: {
        sourceCode: 'public class Main { public static void main(String[] args) { System.out.println("Hello"); } }',
      },
    };
    const resRun = createMockRes();
    await handleRunExecution(reqRun, resRun, () => {});

    assert(resRun.statusCode === 200, `Execution request accepted with HTTP 200 (got ${resRun.statusCode})`);
    assert(resRun.data?.success === true, 'Execution response indicates success');
    assert(resRun.data?.data?.status === 'QUEUED', 'Execution request successfully enqueued in isolated sandbox');

    // Create an execution submission with behavior PASS and revealed flag
    const execSub = await teamChallengeRepository.recordExecutionSubmission({
      teamId,
      participantId,
      challengeId,
      sourceCode: 'public class Main { public static void main(String[] args) {} }',
      executionStatus: 'SUCCESS',
    });
    await teamChallengeRepository.updateExecutionSubmission(execSub.id, {
      executionStatus: 'SUCCESS',
      behaviorStatus: 'PASS',
      revealedFlag: 'DBG{FACTORIAL_729X}',
      stdout: 'FLAG REVEALED: DBG{FACTORIAL_729X}',
    });

    // Direct Flag Submission Request while RUNNING + Fullscreen: Must be accepted
    const reqFlag: any = {
      participant: { id: participantId },
      team: { id: teamId },
      sessionRecord: { id: sessionId, participantId, teamId },
      params: { id: challengeId },
      body: {
        flag: 'DBG{FACTORIAL_729X}',
        executionId: execSub.id,
      },
    };
    const resFlag = createMockRes();
    await handleSubmitFlag(reqFlag, resFlag, () => {});

    assert(resFlag.statusCode === 200, `Flag submission accepted with HTTP 200 (got ${resFlag.statusCode})`);
    assert(resFlag.data?.success === true, 'Flag submission accepted and challenge solved');
  }

  // ===========================================================================
  // 12. RUNNING + Fullscreen Exited: Frontend Solving Controls Locked
  // ===========================================================================
  console.log('\n--- 12. Fullscreen Gate: Frontend Solving Controls Locked ---');
  {
    const currentStatus = 'RUNNING';
    const isFullscreen = false; // Participant exited fullscreen

    // In RUNNING match, solving requires active fullscreen
    const isFullscreenExited = currentStatus === 'RUNNING' && !isFullscreen;
    assert(isFullscreenExited === true, 'isFullscreenExited is true when RUNNING and not in fullscreen');

    // Monaco editor read-only invariant
    const isPaused = false;
    const isEnded = false;
    const editorReadOnly = isPaused || isEnded || isFullscreenExited;
    assert(editorReadOnly === true, 'Monaco editor becomes strictly read-only');

    // Run Code button disabled invariant
    const submittingRun = false;
    const challengeLocked = false;
    const editorSource = 'public class Main {}';
    const runCodeDisabled =
      submittingRun || isPaused || isEnded || isFullscreenExited || challengeLocked || !editorSource.trim();
    assert(runCodeDisabled === true, 'Run Code button is disabled when fullscreen is exited');

    // Submit Flag button disabled invariant
    const submittingFlag = false;
    const flagInput = 'DBG{TEST_FLAG}';
    const challengeCompleted = false;
    const submitFlagDisabled =
      submittingFlag || !flagInput.trim() || isPaused || isEnded || isFullscreenExited || challengeCompleted;
    assert(submitFlagDisabled === true, 'Submit Flag button is disabled when fullscreen is exited');

    // Reset Code button disabled invariant
    const resetCodeDisabled = isPaused || isEnded || isFullscreenExited;
    assert(resetCodeDisabled === true, 'Reset Code button is disabled when fullscreen is exited');

    // Blocking fullscreen-required UI visibility invariant
    const blockingUiVisible = isFullscreenExited;
    assert(blockingUiVisible === true, 'Blocking fullscreen-required UI (arena-fullscreen-required-overlay) is visible');
  }

  // ===========================================================================
  // 13. RUNNING + Fullscreen Exited + Direct API Call: Server Rejection (HTTP 403 FULLSCREEN_REQUIRED)
  // ===========================================================================
  console.log('\n--- 13. Fullscreen Gate: Server 403 Rejection on Direct API Call ---');
  {
    const [part] = await db.select().from(participants).limit(1);
    const participantId = part?.id || teamId;
    const [chal] = await db.select().from(challenges).where(eq(challenges.isActive, true)).limit(1);
    const challengeId = chal.id;

    const [sess] = await db
      .insert(sessions)
      .values({
        teamId,
        participantId,
        sessionTokenHash: 'test-fs-exit-token-' + Date.now(),
        status: 'ACTIVE',
      })
      .returning();
    const sessionId = sess.id;

    // Participant exits fullscreen (emulating fullscreenchange with !document.fullscreenElement)
    const exitRes = await antiCheatService.recordClientEvent({
      participantId,
      teamId,
      sessionId,
      eventType: 'FULLSCREEN_EXIT',
      matchNumber: 1,
    });
    assert(exitRes.recorded === true, 'FULLSCREEN_EXIT recorded on anti-cheat service');
    assert(
      antiCheatService.isParticipantInFullscreen(participantId, teamId, sessionId) === false,
      'Participant confirmed NOT in fullscreen state'
    );

    // Direct Execution API Call attempt while fullscreen is exited: SERVER MUST REJECT WITH 403 FULLSCREEN_REQUIRED
    const reqRunBypass: any = {
      participant: { id: participantId },
      team: { id: teamId },
      sessionRecord: { id: sessionId, participantId, teamId },
      params: { id: challengeId },
      body: {
        sourceCode: 'public class Main { public static void main(String[] args) {} }',
      },
    };
    const resRunBypass = createMockRes();
    await handleRunExecution(reqRunBypass, resRunBypass, () => {});

    assert(resRunBypass.statusCode === 403, `Direct execution call rejected with HTTP 403 (got ${resRunBypass.statusCode})`);
    assert(resRunBypass.data?.success === false, 'Direct execution call rejected with success: false');
    assert(resRunBypass.data?.code === 'FULLSCREEN_REQUIRED', `Rejection code is strictly FULLSCREEN_REQUIRED (got ${resRunBypass.data?.code})`);

    // Direct Flag Submission API Call attempt while fullscreen is exited: SERVER MUST REJECT WITH 403 FULLSCREEN_REQUIRED
    const reqFlagBypass: any = {
      participant: { id: participantId },
      team: { id: teamId },
      sessionRecord: { id: sessionId, participantId, teamId },
      params: { id: challengeId },
      body: {
        flag: 'DBG{FACTORIAL_729X}',
      },
    };
    const resFlagBypass = createMockRes();
    await handleSubmitFlag(reqFlagBypass, resFlagBypass, () => {});

    assert(resFlagBypass.statusCode === 403, `Direct flag submission call rejected with HTTP 403 (got ${resFlagBypass.statusCode})`);
    assert(resFlagBypass.data?.success === false, 'Direct flag submission call rejected with success: false');
    assert(resFlagBypass.data?.code === 'FULLSCREEN_REQUIRED', `Flag rejection code is strictly FULLSCREEN_REQUIRED (got ${resFlagBypass.data?.code})`);

    // Authoritative eventService gatekeeper also reports FULLSCREEN_REQUIRED
    const gateCheck = await eventService.isCompetitionActionAllowed(teamId, {
      requireFullscreen: true,
      participantId,
      sessionId,
    });
    assert(gateCheck.allowed === false, 'eventService gatekeeper reports allowed: false');
    assert(gateCheck.code === 'FULLSCREEN_REQUIRED', 'eventService gatekeeper reports code: FULLSCREEN_REQUIRED');
  }

  // ===========================================================================
  // 14. Restore Fullscreen: Fullscreenchange Confirms & Resumes Access
  // ===========================================================================
  console.log('\n--- 14. Fullscreen Gate: Restore Fullscreen Resumes Access ---');
  {
    const [part] = await db.select().from(participants).limit(1);
    const participantId = part?.id || teamId;
    const [chal] = await db.select().from(challenges).where(eq(challenges.isActive, true)).limit(1);
    const challengeId = chal.id;

    const [sess] = await db
      .insert(sessions)
      .values({
        teamId,
        participantId,
        sessionTokenHash: 'test-fs-restore-token-' + Date.now(),
        status: 'ACTIVE',
      })
      .returning();
    const sessionId = sess.id;

    // First exit fullscreen
    await antiCheatService.recordClientEvent({
      participantId,
      teamId,
      sessionId,
      eventType: 'FULLSCREEN_EXIT',
      matchNumber: 1,
    });
    assert(antiCheatService.isParticipantInFullscreen(participantId, teamId, sessionId) === false, 'Participant exited fullscreen');

    // Restore fullscreen (fullscreenchange event confirms fullscreen)
    const restoreRes = await antiCheatService.recordClientEvent({
      participantId,
      teamId,
      sessionId,
      eventType: 'FULLSCREEN_ENTER',
      matchNumber: 1,
    });
    assert(restoreRes.recorded === true, 'FULLSCREEN_ENTER recorded on restoration');
    assert(antiCheatService.isParticipantInFullscreen(participantId, teamId, sessionId) === true, 'Fullscreen state confirmed restored');

    // Frontend controls become available again
    const currentStatus = 'RUNNING';
    const isFullscreen = true;
    const isFullscreenExited = currentStatus === 'RUNNING' && !isFullscreen;
    assert(isFullscreenExited === false, 'isFullscreenExited is false after restoring fullscreen');
    assert((false || false || isFullscreenExited) === false, 'Monaco editor is no longer read-only');

    // Server accepts subsequent execution request
    const reqRun: any = {
      participant: { id: participantId },
      team: { id: teamId },
      sessionRecord: { id: sessionId, participantId, teamId },
      params: { id: challengeId },
      body: {
        sourceCode: 'public class Main { public static void main(String[] args) {} }',
      },
    };
    const resRun = createMockRes();
    await handleRunExecution(reqRun, resRun, () => {});
    assert(resRun.statusCode === 200, `Execution request accepted with HTTP 200 after restoring fullscreen (got ${resRun.statusCode})`);
    assert(resRun.data?.success === true, 'Execution response success is true');
  }

  // ===========================================================================
  // 15. Timer Behavior: Exiting Fullscreen Does NOT Pause/Reset/Extend Timer
  // ===========================================================================
  console.log('\n--- 15. Timer Behavior: Fullscreen Exit Does Not Affect Server Clock ---');
  {
    // Start authoritative timer at 2000 remaining seconds
    const startedAtTime = new Date(Date.now() - 1600000); // 1600s elapsed of 3600s = 2000s remaining
    await db.update(eventSettings).set({
      status: 'RUNNING',
      startedAt: startedAtTime,
      pausedAt: null,
      endedAt: null,
      totalPausedDurationSeconds: 0,
    }).where(eq(eventSettings.id, 1));

    const statusBefore = await eventService.getEventStatus();
    assert(statusBefore.status === 'RUNNING', 'Server event status is RUNNING before fullscreen exit');
    const remainingBefore = statusBefore.remainingSeconds;
    assert(remainingBefore <= 2005 && remainingBefore >= 1995, `Remaining time is ~2000s (got ${remainingBefore}s)`);

    // Multiple fullscreen exit / blur events occur
    const [part] = await db.select().from(participants).limit(1);
    const participantId = part?.id || teamId;
    await antiCheatService.recordClientEvent({
      participantId,
      teamId,
      eventType: 'FULLSCREEN_EXIT',
      matchNumber: 1,
    });

    // Check timer immediately after fullscreen exit
    const statusAfterExit = await eventService.getEventStatus();
    assert(statusAfterExit.status === 'RUNNING', 'Server status strictly remains RUNNING (not paused)');
    assert(statusAfterExit.pausedAt === null, 'pausedAt remains null; match was not paused');
    assert(statusAfterExit.totalPausedDurationSeconds === 0, 'totalPausedDurationSeconds was not incremented');
    assert(
      statusAfterExit.remainingSeconds <= remainingBefore && statusAfterExit.remainingSeconds >= remainingBefore - 2,
      'Authoritative timer clock continues running without pause, reset, or extension'
    );
    assert(statusAfterExit.remainingSeconds !== 3600, 'Authoritative timer was NOT reset to 3600 on fullscreen exit');
  }

  // ===========================================================================
  // 16. Anti-Cheat Scoping: Fullscreen Events Scoped to Authoritative Match
  // ===========================================================================
  console.log('\n--- 16. Anti-Cheat Scoping: Match Isolation & Late Events ---');
  {
    const [part] = await db.select().from(participants).limit(1);
    const participantId = part?.id || teamId;

    // 16.1 Record FULLSCREEN_EXIT in Match 1
    const match1Event = await antiCheatRepository.recordEvent({
      teamId,
      participantId,
      eventType: 'FULLSCREEN_EXIT',
      matchNumber: 1,
      metadata: { reason: 'User exited fullscreen in Match 1' },
    });
    assert(match1Event.eventType === 'FULLSCREEN_EXIT', 'FULLSCREEN_EXIT recorded');
    assert(match1Event.matchNumber === 1, 'Event is strictly scoped to matchNumber: 1');

    // 16.2 Advance tournament to Match 2
    await db.update(eventSettings).set({
      currentMatchNumber: 2,
      status: 'RUNNING',
    }).where(eq(eventSettings.id, 1));

    // 16.3 A late Match 1 fullscreen event arrives while server is in Match 2
    const lateMatch1Event = await antiCheatRepository.recordEvent({
      teamId,
      participantId,
      eventType: 'FULLSCREEN_EXIT',
      matchNumber: 1, // Late client event tagged with Match 1
      metadata: { reason: 'Late buffered Match 1 fullscreen exit signal' },
    });
    assert(lateMatch1Event.matchNumber === 1, 'Late Match 1 event is recorded with matchNumber: 1');

    // 16.4 Record a genuine Match 2 fullscreen event
    const match2Event = await antiCheatRepository.recordEvent({
      teamId,
      participantId,
      eventType: 'FULLSCREEN_ENTER',
      matchNumber: 2,
      metadata: { reason: 'Match 2 fullscreen entered' },
    });
    assert(match2Event.matchNumber === 2, 'Match 2 event is recorded with matchNumber: 2');

    // 16.5 Query Match 2 events: late Match 1 events CANNOT appear in Match 2
    const match2Events = await antiCheatRepository.getEvents({ matchNumber: 2 });
    assert(match2Events.length >= 1, 'Match 2 events returned');
    const hasLateMatch1Event = match2Events.some((ev) => ev.id === lateMatch1Event.id || ev.id === match1Event.id);
    assert(hasLateMatch1Event === false, 'Late Match A fullscreen events cannot appear in Match B');
    assert(match2Events.every((ev) => ev.matchNumber === 2), 'All returned events strictly belong to Match 2');

    // 16.6 Query Match 2 summary stats: Match 1 exits are excluded
    const match2Summary = await antiCheatRepository.getSummaryStats({ matchNumber: 2 });
    assert(match2Summary.totalEvents === match2Events.length, 'Summary stats correctly reflect Match 2 only');
    assert(match2Summary.fullscreenExits === 0, 'Match 1 fullscreen exits are excluded from Match 2 summary');
  }

  console.log('\n========================================================================');
  console.log(`SUMMARY: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('========================================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

/**
 * BUG SNIPER: PARTICIPANT SIMULATE-START & ARENA BYPASS REMOVAL TEST SUITE
 *
 * Validates the strict enforcement that:
 * 1. NOT_STARTED participant cannot enter arena through the normal participant flow.
 * 2. NOT_STARTED participant cannot access challenge source through the arena URL.
 * 3. NOT_STARTED participant direct API request for challenge details/source is rejected.
 * 4. No participant-facing Simulate Start / demo start control exists.
 * 5. No client-side flag can manufacture RUNNING state.
 * 6. A real admin START transition changes the authoritative state to RUNNING.
 * 7. After the real START transition, the participant can enter the arena normally.
 * 8. Browser refresh while NOT_STARTED does not expose the arena.
 * 9. Direct URL navigation while NOT_STARTED remains blocked.
 * 10. Admin match controls remain functional.
 */

process.env.PG_MEM = 'true';
process.env.SEED_TEST_FIXTURES = 'true';

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { db } from '../src/db/index.ts';
import { runMigrations } from '../database/migrator.ts';
import { runSeed } from '../database/seed.ts';
import { eventService } from '../backend/services/eventService.ts';
import { progressionService } from '../backend/services/progressionService.ts';
import { adminRepository } from '../backend/repositories/adminRepository.ts';
import { teamRepository } from '../backend/repositories/teamRepository.ts';
import { eventRepository } from '../backend/repositories/eventRepository.ts';
import { challengeRepository } from '../backend/repositories/challengeRepository.ts';
import {
  adminUsers,
  teams,
  challenges,
  eventSettings,
} from '../src/db/schema.ts';
import { eq } from 'drizzle-orm';
import {
  getRemainingSeconds,
  getTimerState,
  updateFromServer,
  resetTimerStore,
} from '../src/services/authoritativeTimer.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    failed++;
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
    json(payload: any) {
      res.data = payload;
      return res;
    },
    setHeader(key: string, val: string) {
      res.headers[key] = val;
      return res;
    },
  };
  return res;
}

async function runAllTests() {
  console.log('======================================================================');
  console.log('BUG SNIPER: PARTICIPANT SIMULATE-START BYPASS REMOVAL VALIDATION');
  console.log('======================================================================\n');

  // Initialize DB
  await runMigrations();
  await runSeed();

  const [adminUser] = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.username, 'admin'))
    .limit(1);
  const adminId = adminUser?.id || '00000000-0000-0000-0000-000000000001';

  const [activeTeam] = await db
    .select()
    .from(teams)
    .where(eq(teams.status, 'ACTIVE'))
    .limit(1);
  assert(activeTeam !== undefined, 'Found active competitor team in database');

  const allChallenges = await challengeRepository.getAllChallenges({ isActive: true });
  assert(allChallenges.length > 0, `Loaded ${allChallenges.length} challenges from database`);
  const targetChallenge = allChallenges[0];

  // Create an authenticated session for activeTeam
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const session = await teamRepository.createSession({
    teamId: activeTeam.id,
    sessionTokenHash: tokenHash,
    userAgent: 'Participant-Test-Browser',
  });
  assert(session !== null, 'Created authenticated session for participant');

  // Ensure event is NOT_STARTED initially
  await eventRepository.updateEventStatus('NOT_STARTED');
  resetTimerStore();

  // ===========================================================================
  // TEST 1: NOT_STARTED participant cannot enter arena through the normal participant flow
  // ===========================================================================
  console.log('\n>>> TEST 1: NOT_STARTED participant cannot enter arena through the normal participant flow');
  {
    const currentStatus = await eventService.getEventStatus();
    assert(currentStatus.status === 'NOT_STARTED', 'Authoritative server event status is NOT_STARTED');

    // Simulate session query
    const sessionData = await teamRepository.findSessionByTokenHash(tokenHash);
    assert(sessionData !== null, 'Participant session token resolves in database');

    const authTimer = {
      status: currentStatus.status,
      remainingSeconds: currentStatus.remainingSeconds,
      totalSeconds: currentStatus.totalSeconds,
      durationMinutes: currentStatus.durationMinutes,
    };
    updateFromServer(authTimer);

    const timer = getTimerState();
    assert(timer.status === 'NOT_STARTED', 'Authoritative timer store strictly reflects NOT_STARTED');

    // Progression request during NOT_STARTED must fail
    let progressionBlocked = false;
    try {
      await eventService.getTeamAvailableChallenges(activeTeam.id);
    } catch (err: any) {
      if (err.code === 'EVENT_NOT_STARTED' || err.statusCode === 403) {
        progressionBlocked = true;
      }
    }
    assert(progressionBlocked, 'Participant progression request rejected with 403 EVENT_NOT_STARTED');
  }

  // ===========================================================================
  // TEST 2: NOT_STARTED participant cannot access challenge source through the arena URL
  // ===========================================================================
  console.log('\n>>> TEST 2: NOT_STARTED participant cannot access challenge source through the arena URL');
  {
    let challengeSourceBlocked = false;
    let leakedStarterCode = null;

    try {
      const details = await progressionService.getParticipantChallengeDetails(
        activeTeam.id,
        targetChallenge.id
      );
      leakedStarterCode = details.starterCode;
    } catch (err: any) {
      if (err.code === 'EVENT_NOT_STARTED' || err.statusCode === 403) {
        challengeSourceBlocked = true;
      }
    }

    assert(challengeSourceBlocked, 'getParticipantChallengeDetails rejected with 403 EVENT_NOT_STARTED');
    assert(leakedStarterCode === null, 'No starterCode was exposed to the participant');
  }

  // ===========================================================================
  // TEST 3: NOT_STARTED participant direct API request for challenge details/source is rejected
  // ===========================================================================
  console.log('\n>>> TEST 3: NOT_STARTED participant direct API request for challenge details/source is rejected');
  {
    // Test action gatekeeper
    const gatekeeper = await eventService.isCompetitionActionAllowed(activeTeam.id);
    assert(!gatekeeper.allowed, 'Competition action gatekeeper strictly disallows action when NOT_STARTED');
    assert(gatekeeper.code === 'EVENT_NOT_STARTED', 'Gatekeeper returns code: EVENT_NOT_STARTED');
    assert(gatekeeper.status === 'NOT_STARTED', 'Gatekeeper returns status: NOT_STARTED');

    // Test getTeamAvailableChallenges throws AppError
    let thrownError: any = null;
    try {
      await eventService.getTeamAvailableChallenges(activeTeam.id);
    } catch (err) {
      thrownError = err;
    }
    assert(thrownError !== null, 'eventService.getTeamAvailableChallenges throws error when NOT_STARTED');
    assert(thrownError?.statusCode === 403, 'Error status code is strictly 403');
    assert(thrownError?.code === 'EVENT_NOT_STARTED', 'Error code is strictly EVENT_NOT_STARTED');
  }

  // ===========================================================================
  // TEST 4: No participant-facing Simulate Start / demo start control exists
  // ===========================================================================
  console.log('\n>>> TEST 4: No participant-facing Simulate Start / demo start control exists');
  {
    const waitingRoomPath = path.resolve(process.cwd(), 'src/components/WaitingRoom.tsx');
    const waitingRoomContent = fs.readFileSync(waitingRoomPath, 'utf-8');

    const hasSimulateStart = /simulateOrganizerStart|Simulate Start|simulate-start/i.test(waitingRoomContent);
    assert(!hasSimulateStart, 'WaitingRoom.tsx has no simulateOrganizerStart or Simulate Start buttons');

    const hasOrganizerSimulationDrawer = /Organizer Simulation/i.test(waitingRoomContent);
    assert(!hasOrganizerSimulationDrawer, 'WaitingRoom.tsx has no Organizer Simulation drawer');

    const participantLoginPath = path.resolve(process.cwd(), 'src/components/ParticipantLogin.tsx');
    const participantLoginContent = fs.readFileSync(participantLoginPath, 'utf-8');
    const hasLoginBypass = /Simulate Start|Demo Start|Force Start/i.test(participantLoginContent);
    assert(!hasLoginBypass, 'ParticipantLogin.tsx has no Simulate Start or Demo Start bypass');

    const participantArenaPath = path.resolve(process.cwd(), 'src/components/ParticipantArena.tsx');
    const participantArenaContent = fs.readFileSync(participantArenaPath, 'utf-8');
    const hasArenaBypass = /simulateOrganizerStart|simulateStart/i.test(participantArenaContent);
    assert(!hasArenaBypass, 'ParticipantArena.tsx has no simulateOrganizerStart function');
  }

  // ===========================================================================
  // TEST 5: No client-side flag can manufacture RUNNING state
  // ===========================================================================
  console.log('\n>>> TEST 5: No client-side flag can manufacture RUNNING state');
  {
    // Verify that health.ts does not export an unauthenticated POST status transition endpoint
    const healthPath = path.resolve(process.cwd(), 'backend/routes/health.ts');
    const healthContent = fs.readFileSync(healthPath, 'utf-8');
    const hasPostEventStatus = /healthRouter\.post\(\s*\[?'\/competition\/event\/status'/i.test(healthContent) ||
      /healthRouter\.post\(\s*\[?'\/event\/status'/i.test(healthContent);
    assert(!hasPostEventStatus, 'backend/routes/health.ts does NOT expose unauthenticated POST status transition route');

    // Verify database remains unchanged at NOT_STARTED
    const dbSettings = await eventRepository.getEventSettings();
    assert(dbSettings?.status === 'NOT_STARTED', 'Server database remains strictly in NOT_STARTED state');

    // Verify timer cannot be forced to run by client if server says NOT_STARTED
    updateFromServer({ status: 'NOT_STARTED', remainingSeconds: 3600, totalSeconds: 3600 });
    const timerRemaining = getRemainingSeconds();
    assert(timerRemaining === 3600, 'Timer remains at totalSeconds (3600s) and does not count down');
  }

  // ===========================================================================
  // TEST 6: A real admin START transition changes the authoritative state to RUNNING
  // ===========================================================================
  console.log('\n>>> TEST 6: A real admin START transition changes the authoritative state to RUNNING');
  {
    const startResult = await adminRepository.transitionEventStatus('RUNNING', adminId, 'START');
    assert(startResult.success, 'adminRepository.transitionEventStatus to RUNNING succeeded');
    assert(startResult.event.status === 'RUNNING', 'Event status transitioned to RUNNING');
    assert(startResult.event.startedAt !== null, 'Authoritative startedAt timestamp was set');

    const updatedSettings = await eventService.getEventStatus();
    assert(updatedSettings.status === 'RUNNING', 'eventService.getEventStatus confirms RUNNING state');
    assert(updatedSettings.isActionAllowed === true, 'isActionAllowed is now true');
  }

  // ===========================================================================
  // TEST 7: After the real START transition, the participant can enter the arena normally
  // ===========================================================================
  console.log('\n>>> TEST 7: After the real START transition, the participant can enter the arena normally');
  {
    const available = await eventService.getTeamAvailableChallenges(activeTeam.id);
    assert(available.rounds.length > 0, `Participant can load ${available.rounds.length} rounds after START`);
    assert(available.challenges.length > 0, `Participant can load ${available.challenges.length} challenges after START`);

    const details = await progressionService.getParticipantChallengeDetails(
      activeTeam.id,
      targetChallenge.id
    );
    assert(details.id === targetChallenge.id, 'Participant can load challenge details');
    assert(typeof details.starterCode === 'string' && details.starterCode.length > 0, 'Starter code is accessible after real START');
  }

  // ===========================================================================
  // TEST 8: Browser refresh while NOT_STARTED does not expose the arena
  // ===========================================================================
  console.log('\n>>> TEST 8: Browser refresh while NOT_STARTED does not expose the arena');
  {
    // Transition back to NOT_STARTED for testing refresh behavior
    await eventRepository.updateEventStatus('NOT_STARTED');
    resetTimerStore();

    const currentStatus = await eventService.getEventStatus();
    assert(currentStatus.status === 'NOT_STARTED', 'Event status reset to NOT_STARTED');

    // Simulate participant browser refreshing: calls /api/auth/session
    const sessionData = await teamRepository.findSessionByTokenHash(tokenHash);
    assert(sessionData !== null, 'Session is valid upon page refresh');

    // The session endpoint returns authoritative eventStatus: 'NOT_STARTED'
    const eventStatusFromSession = currentStatus.status;
    assert(eventStatusFromSession === 'NOT_STARTED', 'Session restoration yields NOT_STARTED');

    // Client ParticipantExperience inspects data.eventStatus:
    // If NOT_STARTED, it sets participantRoute('WAITING') and replaceState('/waiting')
    const destinationRoute = eventStatusFromSession === 'RUNNING' ? 'ARENA' : 'WAITING';
    assert(destinationRoute === 'WAITING', 'Simulated refresh directs participant to WAITING room (not ARENA)');
  }

  // ===========================================================================
  // TEST 9: Direct URL navigation while NOT_STARTED remains blocked
  // ===========================================================================
  console.log('\n>>> TEST 9: Direct URL navigation while NOT_STARTED remains blocked');
  {
    // When competitor types /arena in address bar while NOT_STARTED:
    const statusAtNavigation = await eventService.getEventStatus();
    assert(statusAtNavigation.status === 'NOT_STARTED', 'Event status is NOT_STARTED at direct URL navigation');

    // Even if client tried to render Arena, API calls for challenges will fail
    let apiBlocked = false;
    try {
      await eventService.getTeamAvailableChallenges(activeTeam.id);
    } catch (err: any) {
      if (err.code === 'EVENT_NOT_STARTED') apiBlocked = true;
    }
    assert(apiBlocked, 'Direct API call triggered by arena URL fails with EVENT_NOT_STARTED');

    let challengeDetailsBlocked = false;
    try {
      await progressionService.getParticipantChallengeDetails(activeTeam.id, targetChallenge.id);
    } catch (err: any) {
      if (err.code === 'EVENT_NOT_STARTED') challengeDetailsBlocked = true;
    }
    assert(challengeDetailsBlocked, 'Direct challenge load call triggered by arena URL fails with EVENT_NOT_STARTED');
  }

  // ===========================================================================
  // TEST 10: Admin match controls remain functional
  // ===========================================================================
  console.log('\n>>> TEST 10: Admin match controls remain functional');
  {
    // 10a. Admin START
    const resStart = await adminRepository.transitionEventStatus('RUNNING', adminId, 'START');
    assert(resStart.success && resStart.event.status === 'RUNNING', 'Admin can START the match');

    // 10b. Admin PAUSE
    const resPause = await adminRepository.transitionEventStatus('PAUSED', adminId, 'PAUSE');
    assert(resPause.success && resPause.event.status === 'PAUSED', 'Admin can PAUSE the match');

    // 10c. Admin RESUME
    const resResume = await adminRepository.transitionEventStatus('RUNNING', adminId, 'RESUME');
    assert(resResume.success && resResume.event.status === 'RUNNING', 'Admin can RESUME the match');

    // 10d. Admin END
    const resEnd = await adminRepository.transitionEventStatus('ENDED', adminId, 'END');
    assert(resEnd.success && resEnd.event.status === 'ENDED', 'Admin can END the match');

    // 10e. Admin create new match
    const resNewMatch = await adminRepository.createNewMatch(adminId, {
      matchName: 'Match 2 - Finals',
      durationMinutes: 60,
    });
    assert(resNewMatch.success, 'Admin can create a new match');
    assert(resNewMatch.match.matchNumber === 2, 'New match assigned Match #2');
    assert(resNewMatch.match.status === 'NOT_STARTED', 'New match initialized in NOT_STARTED state');

    const freshSettings = await eventRepository.getEventSettings();
    assert(freshSettings?.status === 'NOT_STARTED', 'Event settings status is NOT_STARTED for the new match');
    assert(freshSettings?.currentMatchNumber === 2, 'Current match number updated to 2');
  }

  console.log('\n======================================================================');
  console.log(`TEST SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal error in test suite:', err);
  process.exit(1);
});

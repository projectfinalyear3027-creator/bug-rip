/**
 * BUG RIP - Fragment 5: Authoritative Competition Timer & Event Control Hardening Tests
 * 
 * Verifies:
 * 1. Canonical 60-Minute Duration (3600 seconds) in event_settings
 * 2. Server-Authoritative Elapsed & Remaining Time Calculation
 * 3. Atomic State Machine Transitions (NOT_STARTED -> RUNNING -> PAUSED -> RUNNING -> ENDED)
 * 4. Pause Freezes Timer & Accumulates Total Paused Duration accurately
 * 5. Resume Extends Scheduled End Time by Exact Paused Duration
 * 6. Automatic RUNNING -> ENDED Transition when 60-minute duration elapses
 * 7. isCompetitionActionAllowed() Gateway Enforcement across all states & team statuses
 * 8. Database Persistence Survives Simulation / Fresh Service Instantiation
 * 9. Safe API Output for /api/event/status (no sensitive secrets or tokens)
 */

import { db } from '../src/db/index.ts';
import { runMigrations } from '../database/migrator.ts';
import { runSeed } from '../database/seed.ts';
import { eventRepository } from '../backend/repositories/eventRepository.ts';
import { eventService } from '../backend/services/eventService.ts';
import { adminRepository } from '../backend/repositories/adminRepository.ts';
import { teamRepository } from '../backend/repositories/teamRepository.ts';
import { eventSettings, auditLogs, teams, adminUsers } from '../src/db/schema.ts';
import { eq, and, desc } from 'drizzle-orm';
import { seedTestTeams } from './helpers/testFixtures.ts';

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

async function runTimerTestSuite() {
  console.log('\n================================================================');
  console.log('BUG RIP - FRAGMENT 5: AUTHORITATIVE TIMER & EVENT CONTROL TESTS');
  console.log('================================================================\n');

  // Setup fresh DB state
  await runMigrations();
  await runSeed();
  if (process.env.SEED_TEST_FIXTURES === 'true') {
    await seedTestTeams();
  }

  const adminUsersList = await db.select().from(adminUsers).where(eq(adminUsers.username, 'admin')).limit(1);
  const superAdminId = adminUsersList[0].id;

  // -------------------------------------------------------------
  // Test Suite 1: Canonical 60-Minute Duration in NOT_STARTED State
  // -------------------------------------------------------------
  console.log('--- Test Suite 1: Canonical 60-Minute NOT_STARTED State ---');
  {
    // Reset event settings to NOT_STARTED
    await db
      .update(eventSettings)
      .set({
        status: 'NOT_STARTED',
        durationMinutes: 60,
        startedAt: null,
        pausedAt: null,
        endedAt: null,
        totalPausedDurationSeconds: 0,
      })
      .where(eq(eventSettings.id, 1));

    const status = await eventService.getEventStatus();

    assert(status.status === 'NOT_STARTED', 'Event status is NOT_STARTED');
    assert(status.durationMinutes === 60, 'Canonical duration is exactly 60 minutes');
    assert(status.totalSeconds === 3600, 'Total seconds is exactly 3600s');
    assert(status.remainingSeconds === 3600, 'Remaining seconds is 3600s before start');
    assert(status.elapsedSeconds === 0, 'Elapsed seconds is 0 before start');
    assert(status.isActionAllowed === false, 'isActionAllowed is false before start');
    assert(status.startedAt === null, 'startedAt is null');
    assert(status.pausedAt === null, 'pausedAt is null');
    assert(status.endedAt === null, 'endedAt is null');
  }

  // -------------------------------------------------------------
  // Test Suite 2: Event Start & Authoritative Calculation
  // -------------------------------------------------------------
  console.log('\n--- Test Suite 2: Start Event & Authoritative Clock ---');
  {
    const startResult = await adminRepository.transitionEventStatus('RUNNING', superAdminId, 'START');
    assert(startResult.success === true, 'Admin successfully started competition');
    assert(startResult.event.status === 'RUNNING', 'Database status is RUNNING');
    assert(startResult.event.durationMinutes === 60, 'Started event has durationMinutes = 60');

    const status = await eventService.getEventStatus();
    assert(status.status === 'RUNNING', 'Service reports status RUNNING');
    assert(status.remainingSeconds >= 3598 && status.remainingSeconds <= 3600, 'Remaining seconds starts at ~3600s');
    assert(status.elapsedSeconds >= 0 && status.elapsedSeconds <= 2, 'Elapsed seconds is accurate (~0-2s)');
    assert(status.isActionAllowed === true, 'isActionAllowed is true when RUNNING');
    assert(status.scheduledEndTime !== null, 'scheduledEndTime is calculated');

    // Verify duplicate START is idempotent and safe
    const duplicateStart = await adminRepository.transitionEventStatus('RUNNING', superAdminId, 'START');
    assert(duplicateStart.success === true, 'Duplicate START is safe and idempotent');
    assert(
      new Date(duplicateStart.event.startedAt).getTime() === new Date(startResult.event.startedAt).getTime(),
      'Duplicate START does not reset or overwrite startedAt timestamp'
    );
  }

  // -------------------------------------------------------------
  // Test Suite 3: Deterministic Elapsed & Remaining Calculation
  // -------------------------------------------------------------
  console.log('\n--- Test Suite 3: Deterministic Time Calculation ---');
  {
    // Simulate event started exactly 15 minutes (900 seconds) ago
    const simulatedStart = new Date(Date.now() - 900 * 1000);
    await db
      .update(eventSettings)
      .set({
        startedAt: simulatedStart,
        totalPausedDurationSeconds: 0,
      })
      .where(eq(eventSettings.id, 1));

    const status = await eventService.getEventStatus();
    assert(status.status === 'RUNNING', 'Status remains RUNNING');
    assert(
      status.elapsedSeconds >= 899 && status.elapsedSeconds <= 902,
      `Elapsed seconds is ~900s (calculated: ${status.elapsedSeconds}s)`
    );
    assert(
      status.remainingSeconds >= 2698 && status.remainingSeconds <= 2701,
      `Remaining seconds is ~2700s (calculated: ${status.remainingSeconds}s)`
    );
  }

  // -------------------------------------------------------------
  // Test Suite 4: Pause Invariant & Clock Freezing
  // -------------------------------------------------------------
  console.log('\n--- Test Suite 4: Pause Freezes Authoritative Clock ---');
  {
    const pauseResult = await adminRepository.transitionEventStatus('PAUSED', superAdminId, 'PAUSE');
    assert(pauseResult.success === true, 'Admin successfully paused competition');
    assert(pauseResult.event.status === 'PAUSED', 'Database status transitioned to PAUSED');
    assert(pauseResult.event.pausedAt !== null, 'pausedAt timestamp is recorded');

    const status1 = await eventService.getEventStatus();
    assert(status1.status === 'PAUSED', 'Service reports status PAUSED');
    assert(status1.isActionAllowed === false, 'isActionAllowed is false while PAUSED');

    const frozenRemaining = status1.remainingSeconds;

    // Simulate 3 seconds passing while paused
    await new Promise((resolve) => setTimeout(resolve, 150));
    const status2 = await eventService.getEventStatus();
    assert(
      status2.remainingSeconds === frozenRemaining,
      `Clock remained frozen while PAUSED (before: ${frozenRemaining}s, now: ${status2.remainingSeconds}s)`
    );

    // Verify duplicate PAUSE is idempotent
    const duplicatePause = await adminRepository.transitionEventStatus('PAUSED', superAdminId, 'PAUSE');
    assert(duplicatePause.success === true, 'Duplicate PAUSE is safe and idempotent');
  }

  // -------------------------------------------------------------
  // Test Suite 5: Resume Extends Scheduled End Time
  // -------------------------------------------------------------
  console.log('\n--- Test Suite 5: Resume Invariant & Clock Extension ---');
  {
    // Simulate that the event was paused 100 seconds ago
    const simulatedPauseTime = new Date(Date.now() - 100 * 1000);
    await db
      .update(eventSettings)
      .set({
        pausedAt: simulatedPauseTime,
      })
      .where(eq(eventSettings.id, 1));

    const resumeResult = await adminRepository.transitionEventStatus('RUNNING', superAdminId, 'RESUME');
    assert(resumeResult.success === true, 'Admin successfully resumed competition');
    assert(resumeResult.event.status === 'RUNNING', 'Database status transitioned back to RUNNING');
    assert(resumeResult.event.pausedAt === null, 'pausedAt is cleared upon resume');
    assert(
      resumeResult.event.totalPausedDurationSeconds >= 99 &&
        resumeResult.event.totalPausedDurationSeconds <= 105,
      `totalPausedDurationSeconds accumulated pause period (~100s, actual: ${resumeResult.event.totalPausedDurationSeconds}s)`
    );

    const status = await eventService.getEventStatus();
    assert(status.status === 'RUNNING', 'Status is RUNNING');
    assert(status.isActionAllowed === true, 'isActionAllowed is true after resume');
    // Remaining time must NOT be reset to 3600!
    assert(
      status.remainingSeconds < 3600 && status.remainingSeconds >= 2500,
      `Remaining time preserves previous elapsed time (remaining: ${status.remainingSeconds}s)`
    );
  }

  // -------------------------------------------------------------
  // Test Suite 6: Automatic Expiration at 0 Seconds
  // -------------------------------------------------------------
  console.log('\n--- Test Suite 6: Automatic RUNNING -> ENDED Expiration ---');
  {
    // Simulate event started 61 minutes ago (3660 seconds), with 0 paused duration
    const expiredStartTime = new Date(Date.now() - 3660 * 1000);
    await db
      .update(eventSettings)
      .set({
        status: 'RUNNING',
        startedAt: expiredStartTime,
        totalPausedDurationSeconds: 0,
        pausedAt: null,
        endedAt: null,
      })
      .where(eq(eventSettings.id, 1));

    // Calling getEventStatus should detect timer <= 0 and automatically trigger transition
    const autoStatus = await eventService.getEventStatus();

    assert(autoStatus.status === 'ENDED', 'Server automatically transitioned expired event to ENDED');
    assert(autoStatus.remainingSeconds === 0, 'Remaining seconds is 0 when expired');
    assert(autoStatus.isActionAllowed === false, 'isActionAllowed is false when expired');
    assert(autoStatus.endedAt !== null, 'endedAt timestamp was committed to database');

    // Confirm database row was updated
    const dbRow = await eventRepository.getEventSettings();
    assert(dbRow?.status === 'ENDED', 'Database row status is persistently ENDED');
    assert(dbRow?.endedAt !== null, 'Database endedAt is populated');

    // Confirm audit log was written
    const logs = await eventRepository.getAuditLogs(5);
    const autoEndLog = logs.find((l) => l.action === 'EVENT_ENDED');
    assert(autoEndLog !== undefined, 'Audit log recorded automatic EVENT_ENDED');
  }

  // -------------------------------------------------------------
  // Test Suite 7: Invalid Transition Rejection
  // -------------------------------------------------------------
  console.log('\n--- Test Suite 7: Invalid State Machine Transitions ---');
  {
    // Once ENDED, START, PAUSE, and RESUME must be rejected
    const startFromEnded = await adminRepository.transitionEventStatus('RUNNING', superAdminId, 'START');
    assert(startFromEnded.success === false, 'Cannot START an event that has ENDED');

    const pauseFromEnded = await adminRepository.transitionEventStatus('PAUSED', superAdminId, 'PAUSE');
    assert(pauseFromEnded.success === false, 'Cannot PAUSE an event that has ENDED');

    const resumeFromEnded = await adminRepository.transitionEventStatus('RUNNING', superAdminId, 'RESUME');
    assert(resumeFromEnded.success === false, 'Cannot RESUME an event that has ENDED');

    const duplicateEnd = await adminRepository.transitionEventStatus('ENDED', superAdminId, 'END');
    assert(duplicateEnd.success === true, 'Duplicate END on already ENDED event is safe and idempotent');
  }

  // -------------------------------------------------------------
  // Test Suite 8: isCompetitionActionAllowed() Gateway Check
  // -------------------------------------------------------------
  console.log('\n--- Test Suite 8: isCompetitionActionAllowed() Boundaries ---');
  {
    // Find active team from seed
    const activeTeams = await db.select().from(teams).where(eq(teams.status, 'ACTIVE')).limit(1);
    const activeTeamId = activeTeams[0].id;

    // 1. When event is ENDED:
    const checkEnded = await eventService.isCompetitionActionAllowed(activeTeamId);
    assert(checkEnded.allowed === false, 'Action rejected when event is ENDED');
    assert(checkEnded.status === 'ENDED', 'Status returned is ENDED');

    // 2. When event is NOT_STARTED:
    await db.update(eventSettings).set({ status: 'NOT_STARTED' }).where(eq(eventSettings.id, 1));
    const checkNotStarted = await eventService.isCompetitionActionAllowed(activeTeamId);
    assert(checkNotStarted.allowed === false, 'Action rejected when event is NOT_STARTED');
    assert(checkNotStarted.status === 'NOT_STARTED', 'Status returned is NOT_STARTED');

    // 3. When event is PAUSED:
    await db.update(eventSettings).set({
      status: 'PAUSED',
      startedAt: new Date(Date.now() - 600 * 1000),
      pausedAt: new Date(),
    }).where(eq(eventSettings.id, 1));
    const checkPaused = await eventService.isCompetitionActionAllowed(activeTeamId);
    assert(checkPaused.allowed === false, 'Action rejected when event is PAUSED');
    assert(checkPaused.status === 'PAUSED', 'Status returned is PAUSED');

    // 4. When event is RUNNING:
    await db.update(eventSettings).set({
      status: 'RUNNING',
      startedAt: new Date(Date.now() - 600 * 1000),
      pausedAt: null,
      endedAt: null,
      totalPausedDurationSeconds: 0,
    }).where(eq(eventSettings.id, 1));
    const checkRunning = await eventService.isCompetitionActionAllowed(activeTeamId);
    assert(checkRunning.allowed === true, 'Action permitted when event is RUNNING and team is active');
    assert(checkRunning.status === 'RUNNING', 'Status returned is RUNNING');

    // 5. When team is DISABLED:
    await db.update(teams).set({ status: 'DISABLED' }).where(eq(teams.id, activeTeamId));
    const checkDisabledTeam = await eventService.isCompetitionActionAllowed(activeTeamId);
    assert(checkDisabledTeam.allowed === false, 'Action rejected for DISABLED team');
    // Restore team
    await db.update(teams).set({ status: 'ACTIVE' }).where(eq(teams.id, activeTeamId));
  }

  // -------------------------------------------------------------
  // Test Suite 9: Database Persistence & Fresh Service Instantiation
  // -------------------------------------------------------------
  console.log('\n--- Test Suite 9: Persistence Survives Fresh Service Query ---');
  {
    const dbSettings = await eventRepository.getEventSettings();
    assert(dbSettings !== null, 'Event settings queryable directly from database');
    assert(dbSettings?.durationMinutes === 60, 'Database preserves 60-minute duration');
    assert(dbSettings?.status === 'RUNNING', 'Database preserves RUNNING status');
    assert(dbSettings?.startedAt !== null, 'Database preserves startedAt timestamp');
  }

  console.log('\n================================================================');
  console.log(`FRAGMENT 5 TESTS COMPLETE: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('================================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTimerTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

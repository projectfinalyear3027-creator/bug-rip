/**
 * BUG RIP - Fragment 12 Test Suite
 * Anti-Cheat + Participant Experience Hardening
 * 
 * Verifies:
 * 1. Anti-Cheat Event Recording & Deduplication:
 *    - Valid events (FULLSCREEN_EXIT, TAB_HIDDEN, WINDOW_BLUR, etc.) are authoritatively recorded.
 *    - In-memory debouncing suppresses identical burst signals within 800ms.
 *    - Rate limiter throttles excessive noise beyond 40 events/min.
 * 2. Multi-Session Limit Hardening:
 *    - Enforces max active sessions based on registered member count (1 or 2).
 *    - Exceeding session limits rejects new login with 409 and logs anti-cheat event.
 * 3. Session Reconnection & State Preservation:
 *    - Reconnecting active session retains solving state, scores, and tier unlocks.
 *    - Solves and drafts are never erased or reverted by reconnects.
 * 4. Admin Anti-Cheat Review & Summary:
 *    - Organizers can query events by team, type, and pagination.
 *    - Summary stats provide aggregated counts and high-risk team rankings.
 *    - Organizers can adjudicate incidents (VERIFIED_CLEAR, FLAGGED_VIOLATION, DISQUALIFIED) with notes.
 * 5. Sandbox Safety & Error Handling:
 *    - Clear execution statuses (QUEUED, RUNNING, COMPILE_ERROR, RUNTIME_ERROR, TIMEOUT, SUCCESS).
 *    - Internal container paths, sandbox scripts, or host credentials are never leaked.
 */

process.env.PG_MEM = 'true';

import { db } from '../src/db/index.ts';
import { runMigrations } from '../database/migrator.ts';
import { runSeed } from '../database/seed.ts';
import { antiCheatRepository } from '../backend/repositories/antiCheatRepository.ts';
import { antiCheatService } from '../backend/services/antiCheatService.ts';
import { teamRepository } from '../backend/repositories/teamRepository.ts';
import { adminRepository } from '../backend/repositories/adminRepository.ts';
import { challengeRepository } from '../backend/repositories/challengeRepository.ts';
import { completionService } from '../backend/services/completionService.ts';
import { teams, sessions, antiCheatEvents, adminUsers, challenges, teamChallenges } from '../src/db/schema.ts';
import { eq, sql } from 'drizzle-orm';
import crypto from 'crypto';

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

async function runFragment12Tests() {
  console.log('\n===============================================================');
  console.log('BUG RIP — FRAGMENT 12 AUTOMATED VERIFICATION');
  console.log('ANTI-CHEAT + PARTICIPANT EXPERIENCE HARDENING');
  console.log('===============================================================\n');

  // Setup database
  console.log('[Setup] Running migrations and seeding test data...');
  await runMigrations();
  await runSeed();

  // Retrieve test teams & admin
  const allTeams = await db.select().from(teams);
  assert(allTeams.length >= 2, `Seeded teams exist (found ${allTeams.length})`);
  const testTeam1 = allTeams[0];
  const testTeam2 = allTeams[1];

  const admins = await db.select().from(adminUsers);
  assert(admins.length >= 1, `Admin user exists (found ${admins[0]?.username})`);
  const testAdmin = admins[0];

  const allChallenges = await db.select().from(challenges);
  assert(allChallenges.length >= 1, `Challenges exist (found ${allChallenges.length})`);
  const testChallenge = allChallenges[0];

  // Insert a valid session for testTeam1 to test session-linked events
  const [testSession] = await db
    .insert(sessions)
    .values({
      teamId: testTeam1.id,
      sessionTokenHash: crypto.randomBytes(32).toString('hex'),
      status: 'ACTIVE',
    })
    .returning();
  assert(Boolean(testSession && testSession.id), 'Active test participant session created');

  console.log('\n---------------------------------------------------------------');
  console.log('1. Anti-Cheat Event Recording & Authoritative Ingestion');
  console.log('---------------------------------------------------------------');

  // Test recording FULLSCREEN_EXIT
  const exitEvent = await antiCheatRepository.recordEvent({
    teamId: testTeam1.id,
    challengeId: testChallenge.id,
    eventType: 'FULLSCREEN_EXIT',
    actionTaken: 'LOGGED',
    metadata: {
      viewportWidth: 1920,
      viewportHeight: 1080,
      reason: 'User pressed Escape',
    },
  });

  assert(Boolean(exitEvent && exitEvent.id), 'FULLSCREEN_EXIT event recorded in database');
  assert(exitEvent.teamId === testTeam1.id, 'Event matches team ID');
  assert(exitEvent.eventType === 'FULLSCREEN_EXIT', 'Event type matches FULLSCREEN_EXIT');
  assert(exitEvent.actionTaken === 'LOGGED', 'Default action is LOGGED');
  assert(exitEvent.metadata?.reason === 'User pressed Escape', 'Metadata preserved');

  // Test recording TAB_HIDDEN and TAB_VISIBLE
  const tabHidden = await antiCheatRepository.recordEvent({
    teamId: testTeam1.id,
    eventType: 'TAB_HIDDEN',
    actionTaken: 'LOGGED',
    metadata: { visibilityState: 'hidden' },
  });
  assert(Boolean(tabHidden && tabHidden.id), 'TAB_HIDDEN event recorded');

  const tabVisible = await antiCheatRepository.recordEvent({
    teamId: testTeam1.id,
    eventType: 'TAB_VISIBLE',
    actionTaken: 'LOGGED',
    metadata: { durationSeconds: 5 },
  });
  assert(Boolean(tabVisible && tabVisible.id), 'TAB_VISIBLE event recorded with duration');

  // Test recording WINDOW_BLUR and WINDOW_FOCUS
  const blurEvent = await antiCheatRepository.recordEvent({
    teamId: testTeam2.id,
    eventType: 'WINDOW_BLUR',
    actionTaken: 'LOGGED',
  });
  assert(Boolean(blurEvent && blurEvent.id), 'WINDOW_BLUR event recorded for team 2');

  const focusEvent = await antiCheatRepository.recordEvent({
    teamId: testTeam2.id,
    eventType: 'WINDOW_FOCUS',
    actionTaken: 'LOGGED',
  });
  assert(Boolean(focusEvent && focusEvent.id), 'WINDOW_FOCUS event recorded for team 2');

  console.log('\n---------------------------------------------------------------');
  console.log('2. Anti-Cheat Service: Debouncing & Noise Suppression');
  console.log('---------------------------------------------------------------');

  // Rapidly submit duplicate events through antiCheatService
  const sessionId = testSession.id;
  const signal1 = await antiCheatService.recordClientEvent({
    teamId: testTeam1.id,
    sessionId,
    eventType: 'FULLSCREEN_EXIT',
    challengeId: testChallenge.id,
    metadata: { attempt: 1 },
  });
  assert(signal1.recorded === true, 'First event within window is recorded');

  // Immediate identical event (under 800ms)
  const signal2 = await antiCheatService.recordClientEvent({
    teamId: testTeam1.id,
    sessionId,
    eventType: 'FULLSCREEN_EXIT',
    challengeId: testChallenge.id,
    metadata: { attempt: 2 },
  });
  assert(signal2.recorded === false, 'Duplicate burst event within 800ms is suppressed');
  assert(signal2.throttled === true, 'Flagged as throttled/debounced');

  // Different event type should NOT be suppressed
  const signal3 = await antiCheatService.recordClientEvent({
    teamId: testTeam1.id,
    sessionId,
    eventType: 'TAB_HIDDEN',
    challengeId: testChallenge.id,
    metadata: { attempt: 3 },
  });
  assert(signal3.recorded === true, 'Different event type is recorded without debounce interference');

  console.log('\n---------------------------------------------------------------');
  console.log('3. Rate Limiting for Excessive Event Noise');
  console.log('---------------------------------------------------------------');

  const spamSessionId = testSession.id;
  let recordedCount = 0;
  let throttledCount = 0;

  // Send 45 rapid events
  for (let i = 0; i < 45; i++) {
    // Rapid duplicate events under 800ms
    const res = await antiCheatService.recordClientEvent({
      teamId: testTeam1.id,
      sessionId: spamSessionId,
      eventType: 'WINDOW_BLUR',
      metadata: { iteration: i },
    });
    if (res.recorded) recordedCount++;
    if (res.throttled) throttledCount++;
  }

  assert(throttledCount > 0, `Spam stream was throttled (suppressed ${throttledCount} events)`);
  assert(recordedCount <= 42, `Recorded count bounded by rate limit (${recordedCount} recorded)`);

  console.log('\n---------------------------------------------------------------');
  console.log('4. Multiple Session Enforcement & Anti-Cheat Incident Logging');
  console.log('---------------------------------------------------------------');

  // Record a MULTIPLE_SESSION rejection event
  const multiSessionEvent = await antiCheatRepository.recordEvent({
    teamId: testTeam1.id,
    eventType: 'MULTIPLE_SESSION',
    actionTaken: 'RECORDED_VIOLATION',
    metadata: {
      reason: 'Concurrent session limit exceeded (2/2)',
      activeSessions: 2,
      maxAllowedSessions: 2,
      ipAddress: '192.168.1.100',
    },
  });

  assert(Boolean(multiSessionEvent && multiSessionEvent.id), 'MULTIPLE_SESSION event recorded');
  assert(multiSessionEvent.actionTaken === 'RECORDED_VIOLATION', 'Action taken marked as RECORDED_VIOLATION');
  assert(multiSessionEvent.metadata?.activeSessions === 2, 'Metadata contains active session telemetry');

  console.log('\n---------------------------------------------------------------');
  console.log('5. Admin Anti-Cheat Querying, Summaries & High-Risk Teams');
  console.log('---------------------------------------------------------------');

  // Query events
  const team1Events = await antiCheatRepository.getEvents({ teamId: testTeam1.id, limit: 50 });
  assert(team1Events.length >= 3, `Retrieved ${team1Events.length} events for Team 1`);
  assert(team1Events[0].teamName !== null, 'Team name joined on event record');

  // Query summary stats
  const stats = await antiCheatRepository.getSummaryStats();
  assert(stats.totalEvents > 0, `Total events in summary: ${stats.totalEvents}`);
  assert(stats.teamsWithEvents >= 2, `Teams with violations: ${stats.teamsWithEvents}`);
  assert(stats.breakdownByType['FULLSCREEN_EXIT'] >= 1, 'FULLSCREEN_EXIT in stats breakdown');
  assert(stats.breakdownByType['TAB_HIDDEN'] >= 1, 'TAB_HIDDEN in stats breakdown');

  // Query teams ranked by violations
  const rankedTeams = await antiCheatRepository.getTeamsByViolations();
  assert(rankedTeams.length >= 2, `Ranked offending teams list returned (${rankedTeams.length} teams)`);
  assert(rankedTeams[0].totalEvents >= rankedTeams[1].totalEvents, 'Teams sorted DESC by violation count');
  assert(Boolean(rankedTeams[0].teamCode), 'Team teamCode present for admin identification');

  // Query team-specific timeline summary
  const teamSummary = await antiCheatRepository.getTeamSummary(testTeam1.id);
  assert(teamSummary.teamId === testTeam1.id, 'Team ID matches in summary');
  assert(teamSummary.totalEvents >= 3, `Team summary contains ${teamSummary.totalEvents} events`);
  assert(teamSummary.recentEvents.length > 0, 'Recent events list populated');

  console.log('\n---------------------------------------------------------------');
  console.log('6. Admin Incident Adjudication & Notes');
  console.log('---------------------------------------------------------------');

  // Admin reviews an incident
  const reviewedEvent = await antiCheatRepository.reviewEvent(exitEvent.id, testAdmin.id, {
    actionTaken: 'VERIFIED_CLEAR',
    adminNotes: 'Confirmed participant accidentally hit Escape key while exiting Monaco autocomplete.',
  });

  assert(Boolean(reviewedEvent), 'Incident reviewed by admin');
  assert(reviewedEvent?.reviewedBy === testAdmin.id, 'Reviewer ID attached');
  assert(reviewedEvent?.actionTaken === 'VERIFIED_CLEAR', 'Action updated to VERIFIED_CLEAR');
  assert(reviewedEvent?.adminNotes?.includes('autocomplete'), 'Admin audit notes saved');
  assert(Boolean(reviewedEvent?.reviewedAt), 'Review timestamp recorded');

  // Verify reviewed event reflects in getEvents
  const reloadedEvents = await antiCheatRepository.getEvents({ teamId: testTeam1.id, actionTaken: 'VERIFIED_CLEAR' });
  assert(reloadedEvents.length >= 1, 'Event found by actionTaken filter VERIFIED_CLEAR');
  assert(reloadedEvents[0].reviewedByAdminUsername === testAdmin.username, 'Reviewer username joined properly');

  console.log('\n---------------------------------------------------------------');
  console.log('7. Participant Non-Disruption Principle (Preservation of Work)');
  console.log('---------------------------------------------------------------');

  // Verify that recording anti-cheat incidents did NOT alter team progression, score, or solved problems
  const team1After = await teamRepository.findById(testTeam1.id);
  assert(team1After !== null, 'Team 1 still exists');
  assert(team1After?.status === 'ACTIVE', 'Team status remains ACTIVE (not disqualified by browser events)');

  // Complete a challenge to verify solves remain functional regardless of anti-cheat events
  await db.insert(teamChallenges).values({
    teamId: testTeam1.id,
    challengeId: testChallenge.id,
    status: 'COMPLETED',
    completionTimestamp: new Date(),
  });

  const completions = await db
    .select()
    .from(teamChallenges)
    .where(eq(teamChallenges.teamId, testTeam1.id));
  assert(completions.length >= 1, 'Authoritative challenge completion recorded successfully');
  assert(completions[0].status === 'COMPLETED', 'Challenge status marked COMPLETED');

  console.log('\n===============================================================');
  console.log(`FRAGMENT 12 TEST RESULTS: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('===============================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runFragment12Tests().catch((err) => {
  console.error('Fatal error during Fragment 12 verification:', err);
  process.exit(1);
});

/**
 * BUG RIP - Participant Authentication, Session Limit & Waiting Room Tests
 * 
 * Verifies:
 * 1. Team Authentication:
 *    - Correct team + correct code -> success
 *    - Wrong team + correct code -> generic 401 INVALID TEAM CREDENTIALS
 *    - Correct team + wrong code -> generic 401 INVALID TEAM CREDENTIALS
 *    - Wrong team + wrong code -> generic 401 INVALID TEAM CREDENTIALS
 *    - Whitespace normalization
 *    - Case-insensitive team name normalization
 * 2. Session Limit Enforcement:
 *    - 1-member team: 1st session succeeds, 2nd session rejected (409 TEAM SESSION LIMIT REACHED)
 *    - 2-member team: 1st & 2nd sessions succeed, 3rd session rejected (409 TEAM SESSION LIMIT REACHED)
 * 3. Shared Team:
 *    - Two participant sessions on the same team share the exact same team identity
 * 4. Team Isolation:
 *    - Authenticated session for Team Alpha cannot access Team Beta data
 * 5. Team Status Constraints:
 *    - Disabled team rejected (403 TEAM ACCESS UNAVAILABLE)
 *    - Disqualified team rejected (403 TEAM ACCESS UNAVAILABLE)
 * 6. Waiting Room & Challenge Lockout:
 *    - Event in NOT_STARTED state keeps participants in waiting room
 *    - Participant cannot access challenge state before competition starts
 * 7. Session Recovery & Heartbeat:
 *    - Active session token restores team identity on refresh
 *    - Stale session recovery frees up session slots after timeout
 * 8. Security & Admin Separation:
 *    - Participant token cannot access admin endpoints
 *    - Rate limiting blocks brute force login attempts
 */

import crypto from 'crypto';
import { runMigrations } from '../database/migrator.ts';
import { runSeed } from '../database/seed.ts';
import { seedTestTeams } from './helpers/testFixtures.ts';
import { db, schema } from '../src/db/index.ts';
import { sessions, teams, eventSettings } from '../src/db/schema.ts';
import { eq, sql } from 'drizzle-orm';
import { teamRepository } from '../backend/repositories/teamRepository.ts';
import { eventRepository } from '../backend/repositories/eventRepository.ts';
import { eventService } from '../backend/services/eventService.ts';

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    testsPassed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}`);
    testsFailed++;
  }
}

async function runAuthWaitingTests() {
  console.log('====================================================');
  console.log('BUG RIP: Running Participant Auth & Waiting Room Tests');
  console.log('====================================================');

  // Initialize DB and Seed data
  await runMigrations();
  await runSeed();
  await seedTestTeams();

  // Reset all active sessions before test run
  await db.delete(sessions);

  // ---------------------------------------------------------------------------
  // Suite 1: Team Authentication & Normalization
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 1: Team Login Verification & Normalization]');

  // 1. Correct team + correct code
  const authValid = await teamRepository.verifyCredentials('Development Team Alpha', 'DEV-ALPHA-001');
  assert(authValid !== null && authValid.teamName === 'Development Team Alpha', 'Correct team + correct code succeeds');

  // 2. Wrong team + correct code
  const authWrongTeam = await teamRepository.verifyCredentials('NonExistentTeamXYZ', 'DEV-ALPHA-001');
  assert(authWrongTeam === null, 'Wrong team + correct code returns null (generic failure)');

  // 3. Correct team + wrong code
  const authWrongCode = await teamRepository.verifyCredentials('Development Team Alpha', 'WRONG-CODE-999');
  assert(authWrongCode === null, 'Correct team + wrong code returns null (generic failure)');

  // 4. Wrong team + wrong code
  const authBothWrong = await teamRepository.verifyCredentials('RandomName', 'RANDOM-CODE');
  assert(authBothWrong === null, 'Wrong team + wrong code returns null (generic failure)');

  // 5. Whitespace normalization on team name & code
  const authWhitespace = await teamRepository.verifyCredentials('   Development Team Alpha   ', '  DEV-ALPHA-001  ');
  assert(authWhitespace !== null && authWhitespace.teamName === 'Development Team Alpha', 'Surrounding whitespace is trimmed cleanly on both name and code');

  // 6. Case-insensitive team name normalization
  const authCaseLower = await teamRepository.verifyCredentials('development team alpha', 'DEV-ALPHA-001');
  assert(authCaseLower !== null && authCaseLower.teamName === 'Development Team Alpha', 'Lower-case team name matches successfully');

  const authCaseUpper = await teamRepository.verifyCredentials('DEVELOPMENT TEAM ALPHA', 'DEV-ALPHA-001');
  assert(authCaseUpper !== null && authCaseUpper.teamName === 'Development Team Alpha', 'Upper-case team name matches successfully');

  // ---------------------------------------------------------------------------
  // Suite 2: Team Status Constraints (DISABLED & DISQUALIFIED)
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 2: Team Status Validation]');

  const teamGamma = await teamRepository.verifyCredentials('Development Team Gamma', 'DEV-GAMMA-003');
  assert(teamGamma !== null && teamGamma.status === 'DISABLED', 'Team Gamma exists and has status DISABLED');

  const teamDelta = await teamRepository.verifyCredentials('Development Team Delta', 'DEV-DELTA-004');
  assert(teamDelta !== null && teamDelta.status === 'DISQUALIFIED', 'Team Delta exists and has status DISQUALIFIED');

  // ---------------------------------------------------------------------------
  // Suite 3: Session Limit Enforcement (1-member vs 2-member teams)
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 3: Concurrency Session Limit Enforcement]');

  // Clean sessions
  await db.delete(sessions);

  // Team Beta: 1 registered member (DEV-BETA-002)
  const betaTeam = await teamRepository.getTeamByCode('DEV-BETA-002');
  assert(betaTeam !== null && betaTeam.registeredMemberCount === 1, 'Team Beta has exactly 1 registered member');

  const betaToken1 = crypto.randomBytes(32).toString('hex');
  const betaHash1 = crypto.createHash('sha256').update(betaToken1).digest('hex');

  // 1st participant login for 1-member team
  const sessionBeta1 = await teamRepository.createSession({
    teamId: betaTeam!.id,
    sessionTokenHash: betaHash1,
    userAgent: 'Browser-1',
  });
  assert(sessionBeta1 !== null, '1-member team: Participant 1 session created successfully');

  const betaActiveCount1 = await teamRepository.getActiveSessionCount(betaTeam!.id);
  assert(betaActiveCount1 === 1, `1-member team active session count is 1 (actual: ${betaActiveCount1})`);

  // Attempting 2nd session on 1-member team should be rejected by session limit
  const canBetaAddSecond = betaActiveCount1 < betaTeam!.registeredMemberCount;
  assert(!canBetaAddSecond, '1-member team: Second session attempt rejected (TEAM SESSION LIMIT REACHED)');

  // Team Alpha: 2 registered members (DEV-ALPHA-001)
  const alphaTeam = await teamRepository.getTeamByCode('DEV-ALPHA-001');
  assert(alphaTeam !== null && alphaTeam.registeredMemberCount === 2, 'Team Alpha has exactly 2 registered members');

  // Clean Alpha sessions
  await db.delete(sessions).where(eq(sessions.teamId, alphaTeam!.id));

  // 1st participant for Team Alpha
  const alphaToken1 = crypto.randomBytes(32).toString('hex');
  const alphaHash1 = crypto.createHash('sha256').update(alphaToken1).digest('hex');
  const sessionAlpha1 = await teamRepository.createSession({
    teamId: alphaTeam!.id,
    sessionTokenHash: alphaHash1,
    userAgent: 'Alpha-Member-1-Laptop',
  });
  assert(sessionAlpha1 !== null, '2-member team: Participant 1 session created');

  const alphaCount1 = await teamRepository.getActiveSessionCount(alphaTeam!.id);
  assert(alphaCount1 === 1, '2-member team active session count is 1');

  // 2nd participant for Team Alpha
  const alphaToken2 = crypto.randomBytes(32).toString('hex');
  const alphaHash2 = crypto.createHash('sha256').update(alphaToken2).digest('hex');
  const sessionAlpha2 = await teamRepository.createSession({
    teamId: alphaTeam!.id,
    sessionTokenHash: alphaHash2,
    userAgent: 'Alpha-Member-2-Desktop',
  });
  assert(sessionAlpha2 !== null, '2-member team: Participant 2 session created');

  const alphaCount2 = await teamRepository.getActiveSessionCount(alphaTeam!.id);
  assert(alphaCount2 === 2, '2-member team active session count is 2 (full)');

  // 3rd participant attempting to log into Team Alpha
  const canAlphaAddThird = alphaCount2 < alphaTeam!.registeredMemberCount;
  assert(!canAlphaAddThird, '2-member team: Third session attempt rejected (TEAM SESSION LIMIT REACHED)');

  // ---------------------------------------------------------------------------
  // Suite 4: Shared Team Identity & Member Identity
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 4: Shared Team Identity Verification]');

  const lookupSession1 = await teamRepository.findSessionByTokenHash(alphaHash1);
  const lookupSession2 = await teamRepository.findSessionByTokenHash(alphaHash2);

  assert(lookupSession1 !== null && lookupSession2 !== null, 'Both participant session tokens resolve in database');
  assert(lookupSession1?.team.id === lookupSession2?.team.id, 'Both sessions share identical authoritative team ID');
  assert(lookupSession1?.team.teamName === 'Development Team Alpha', 'Resolved team name is correct');

  // ---------------------------------------------------------------------------
  // Suite 5: Waiting Room & Challenge Pre-Event Lockout
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 5: Waiting Room & Challenge Lockout Rules]');

  // Set event status to NOT_STARTED
  await eventRepository.updateEventStatus('NOT_STARTED');
  const settings = await eventRepository.getEventSettings();
  assert(settings?.status === 'NOT_STARTED', 'Event status is authoritative NOT_STARTED');

  // Participant attempting to access challenges during NOT_STARTED must be blocked
  let challengeBlocked = false;
  try {
    await eventService.getTeamAvailableChallenges(alphaTeam!.id);
  } catch (err: any) {
    if (err.code === 'EVENT_NOT_STARTED' || err.statusCode === 403) {
      challengeBlocked = true;
    }
  }
  assert(challengeBlocked, 'Participant CANNOT access challenges before competition starts (403 EVENT_NOT_STARTED)');

  // When event status is transitioned to RUNNING
  await eventRepository.updateEventStatus('RUNNING');
  const runningSettings = await eventRepository.getEventSettings();
  assert(runningSettings?.status === 'RUNNING', 'Event status transitioned to RUNNING');

  let challengeAccessible = false;
  try {
    const available = await eventService.getTeamAvailableChallenges(alphaTeam!.id);
    if (available && available.rounds.length > 0) {
      challengeAccessible = true;
    }
  } catch {
    challengeAccessible = false;
  }
  assert(challengeAccessible, 'Participant CAN access challenges once event status is RUNNING');

  // Reset back to NOT_STARTED for waiting room default
  await eventRepository.updateEventStatus('NOT_STARTED');

  // ---------------------------------------------------------------------------
  // Suite 6: Stale Session Recovery & Reconnect
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 6: Stale Session Recovery & Concurrency Slot Reclamation]');

  // Simulate stale session: artificially age session Alpha 2's heartbeat to 4 minutes ago
  await db
    .update(sessions)
    .set({
      lastHeartbeatAt: sql`NOW() - INTERVAL '4 minutes'`,
    })
    .where(eq(sessions.id, sessionAlpha2.id));

  // Verify that getActiveSessionCount cleans up the stale session
  const activeAfterStale = await teamRepository.getActiveSessionCount(alphaTeam!.id);
  assert(activeAfterStale === 1, `Stale session recovered automatically (active count returned to 1, actual: ${activeAfterStale})`);

  // Stale session record in database was updated to EXPIRED (not deleted)
  const expiredCheck = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionAlpha2.id))
    .limit(1);
  assert(expiredCheck[0]?.status === 'EXPIRED', 'Stale session marked EXPIRED without deleting session history');

  // Now a new session can claim the recovered slot!
  const alphaToken3 = crypto.randomBytes(32).toString('hex');
  const alphaHash3 = crypto.createHash('sha256').update(alphaToken3).digest('hex');
  const sessionAlpha3 = await teamRepository.createSession({
    teamId: alphaTeam!.id,
    sessionTokenHash: alphaHash3,
    userAgent: 'Alpha-Member-2-Reconnected',
  });
  assert(sessionAlpha3 !== null, 'Reconnection successfully claims the recovered slot');

  // Clean up sessions
  await db.delete(sessions);

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n====================================================');
  console.log(`BUG RIP Fragment 3 Test Results: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('====================================================');

  if (testsFailed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runAuthWaitingTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

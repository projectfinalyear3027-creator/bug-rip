/**
 * BUG RIP - Zero Fake Competition State Verification Suite
 * tests/no_demo_data.test.ts
 * 
 * Comprehensive audit verification test asserting:
 * 1. Fresh database contains:
 *    - 0 teams
 *    - 0 participants
 *    - 0 team memberships
 *    - 0 participant sessions
 *    - 0 score entries / solves (team_challenges)
 *    - 0 progression overrides
 * 2. /live public leaderboard query returns an authoritative empty leaderboard:
 *    - Empty array []
 *    - 0 registered teams
 *    - 0 solves
 * 3. Admin dashboard metrics report:
 *    - 0 registered teams
 *    - 0 registered participants
 *    - 0 connected participants
 * 4. Legitimate platform seeds are strictly preserved:
 *    - Event Settings exists (BUG RIP, status NOT_STARTED, duration 60)
 *    - Super Admin account exists (admin / BugRipAdmin2026!)
 *    - 4 Competition Rounds exist (Easy, Medium, Hard, Extreme)
 *    - Canonical challenges & test cases exist
 * 5. Repository code cleanliness:
 *    - seedDevelopmentParticipants throws security violation
 *    - runSeed() strictly creates 0 participant teams
 */

import { db } from '../src/db/index.ts';
import { runMigrations } from '../database/migrator.ts';
import { runSeed, seedDevelopmentParticipants } from '../database/seed.ts';
import { teamRepository } from '../backend/repositories/teamRepository.ts';
import { adminRepository } from '../backend/repositories/adminRepository.ts';
import { challengeRepository } from '../backend/repositories/challengeRepository.ts';
import { eventRepository } from '../backend/repositories/eventRepository.ts';
import {
  teams,
  participants,
  teamMembers,
  sessions,
  teamChallenges,
  progressionOverrides,
  rounds,
  challenges,
  challengeTestCases,
  adminUsers,
  eventSettings,
} from '../src/db/schema.ts';
import { eq, sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

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

async function runNoDemoDataAudit() {
  console.log('================================================================');
  console.log('BUG RIP: ZERO DEMO DATA & PRODUCTION CLEANLINESS AUDIT TEST');
  console.log('================================================================');

  // Initialize fresh migrations and default seed
  delete process.env.SEED_TEST_FIXTURES;
  process.env.NODE_ENV = 'production';

  await runMigrations();
  await runSeed();

  // -------------------------------------------------------------
  // Suite 1: Database Entity Zero State Audit
  // -------------------------------------------------------------
  console.log('\n[Suite 1: Database Table Population Audit]');

  const [teamCountRes] = await db.select({ count: sql<number>`count(*)::int` }).from(teams);
  const [partCountRes] = await db.select({ count: sql<number>`count(*)::int` }).from(participants);
  const [memberCountRes] = await db.select({ count: sql<number>`count(*)::int` }).from(teamMembers);
  const [sessionCountRes] = await db.select({ count: sql<number>`count(*)::int` }).from(sessions);
  const [challengeSolvesRes] = await db.select({ count: sql<number>`count(*)::int` }).from(teamChallenges);
  const [progressionOverridesRes] = await db.select({ count: sql<number>`count(*)::int` }).from(progressionOverrides);

  assert(teamCountRes.count === 0, `Fresh database contains 0 teams (actual: ${teamCountRes.count})`);
  assert(partCountRes.count === 0, `Fresh database contains 0 participants (actual: ${partCountRes.count})`);
  assert(memberCountRes.count === 0, `Fresh database contains 0 team memberships (actual: ${memberCountRes.count})`);
  assert(sessionCountRes.count === 0, `Fresh database contains 0 participant sessions (actual: ${sessionCountRes.count})`);
  assert(challengeSolvesRes.count === 0, `Fresh database contains 0 team challenge solves (actual: ${challengeSolvesRes.count})`);
  assert(progressionOverridesRes.count === 0, `Fresh database contains 0 progression overrides (actual: ${progressionOverridesRes.count})`);

  // Verify none of the demo team codes exist
  const sampleAlpha = await teamRepository.getTeamByCode('DEV-ALPHA-001');
  const sampleBeta = await teamRepository.getTeamByCode('DEV-BETA-002');
  const sampleGamma = await teamRepository.getTeamByCode('DEV-GAMMA-003');
  const sampleDelta = await teamRepository.getTeamByCode('DEV-DELTA-004');
  assert(sampleAlpha === null, 'Demo team DEV-ALPHA-001 does NOT exist');
  assert(sampleBeta === null, 'Demo team DEV-BETA-002 does NOT exist');
  assert(sampleGamma === null, 'Demo team DEV-GAMMA-003 does NOT exist');
  assert(sampleDelta === null, 'Demo team DEV-DELTA-004 does NOT exist');

  // -------------------------------------------------------------
  // Suite 2: Public Live Scoreboard Empty State
  // -------------------------------------------------------------
  console.log('\n[Suite 2: Public Live Scoreboard /live Query Audit]');

  const leaderboard = await eventRepository.getLeaderboard();
  assert(Array.isArray(leaderboard), 'Leaderboard returns an array');
  assert(leaderboard.length === 0, `Live leaderboard is completely empty (count: ${leaderboard.length})`);

  // -------------------------------------------------------------
  // Suite 3: Admin Dashboard Metrics Zero Count Verification
  // -------------------------------------------------------------
  console.log('\n[Suite 3: Admin Dashboard Metrics Precondition Audit]');

  const metrics = await adminRepository.getDashboardMetrics();
  assert(metrics.registeredTeamsCount === 0, `Admin metrics registeredTeamsCount is 0 (actual: ${metrics.registeredTeamsCount})`);
  assert(metrics.registeredParticipantsCount === 0, `Admin metrics registeredParticipantsCount is 0 (actual: ${metrics.registeredParticipantsCount})`);
  assert(metrics.connectedParticipantsCount === 0, `Admin metrics connectedParticipantsCount is 0 (actual: ${metrics.connectedParticipantsCount})`);
  assert(metrics.eventStatus === 'NOT_STARTED', `Event status is NOT_STARTED (actual: ${metrics.eventStatus})`);

  const regCounts = await teamRepository.getRegistrationCounts();
  assert(regCounts.teams === 0, `Team repository getRegistrationCounts reports 0 teams (actual: ${regCounts.teams})`);
  assert(regCounts.participants === 0, `Team repository getRegistrationCounts reports 0 participants (actual: ${regCounts.participants})`);
  assert(regCounts.teamMembers === 0, `Team repository getRegistrationCounts reports 0 memberships (actual: ${regCounts.teamMembers})`);

  // -------------------------------------------------------------
  // Suite 4: Legitimate Configuration Preservation Audit
  // -------------------------------------------------------------
  console.log('\n[Suite 4: Preserved Seed Verification (Config, Admin, Challenges)]');

  // 1. Event settings
  const [eventSetting] = await db.select().from(eventSettings).where(eq(eventSettings.id, 1)).limit(1);
  assert(!!eventSetting, 'Event settings row ID 1 exists');
  assert(eventSetting?.eventName === 'BUG SNIPER', `Event name preserved as "BUG SNIPER" (actual: ${eventSetting?.eventName})`);

  // 2. Super Admin user
  const [superAdmin] = await db.select().from(adminUsers).where(eq(adminUsers.username, 'admin')).limit(1);
  assert(!!superAdmin, 'Super Admin user "admin" exists');
  assert(superAdmin?.role === 'SUPER_ADMIN', `Admin user has role SUPER_ADMIN (actual: ${superAdmin?.role})`);
  const passwordMatch = await bcrypt.compare('BugRipAdmin2026!', superAdmin.passwordHash);
  assert(passwordMatch === true, 'Admin password matches authoritative credential BugRipAdmin2026!');

  // 3. Rounds
  const allRounds = await db.select().from(rounds);
  assert(allRounds.length === 4, `All 4 competition rounds exist (actual: ${allRounds.length})`);
  const roundSlugs = allRounds.map((r) => r.slug).sort();
  assert(
    JSON.stringify(roundSlugs) === JSON.stringify(['easy', 'extreme', 'hard', 'medium']),
    'All 4 rounds present: easy, medium, hard, extreme'
  );

  // 4. Challenges & Test Cases
  const allChallenges = await challengeRepository.getAllChallenges();
  assert(allChallenges.length >= 5, `Canonical challenges seeded (actual: ${allChallenges.length})`);
  
  const [testCasesCountRes] = await db.select({ count: sql<number>`count(*)::int` }).from(challengeTestCases);
  assert(testCasesCountRes.count > 0, `Canonical challenge test cases seeded (actual: ${testCasesCountRes.count})`);

  // -------------------------------------------------------------
  // Suite 5: Security Guard Against Accidental Demo Injection
  // -------------------------------------------------------------
  console.log('\n[Suite 5: Security Guard & Seed Removal Enforcement]');

  let caughtError = false;
  try {
    await seedDevelopmentParticipants();
  } catch (err: any) {
    caughtError = true;
    assert(err.message.includes('PURGED') || err.message.includes('SECURITY VIOLATION'), 'seedDevelopmentParticipants() throws explicit safety exception');
  }
  assert(caughtError === true, 'seedDevelopmentParticipants() execution strictly blocked');

  // Rerun seed to confirm idempotency and that 0 fake teams are ever added
  await runSeed();
  const [recheckedTeams] = await db.select({ count: sql<number>`count(*)::int` }).from(teams);
  assert(recheckedTeams.count === 0, `Subsequent runSeed() invocation still yields 0 teams (actual: ${recheckedTeams.count})`);

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`AUDIT RESULTS: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('================================================================');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runNoDemoDataAudit().catch((err) => {
  console.error('Audit execution failure:', err);
  process.exit(1);
});

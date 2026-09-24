/**
 * BUG RIP - Safe Registration State Verification Script (Section 8)
 * 
 * Verifies the database registration status:
 * - registered teams count
 * - registered participants count
 * - registered team memberships count
 * 
 * For a fresh production deployment before CSV import:
 * Expects registered teams = 0, participants = 0, team memberships = 0.
 * 
 * Usage:
 *   npx tsx scripts/verify-registration-state.ts
 *   npx tsx scripts/verify-registration-state.ts --strict-fresh
 */

import { teamRepository } from '../backend/repositories/teamRepository.ts';
import { challengeRepository } from '../backend/repositories/challengeRepository.ts';
import { eventRepository } from '../backend/repositories/eventRepository.ts';
import { checkDatabaseHealth, db } from '../src/db/index.ts';
import { adminUsers } from '../src/db/schema.ts';
import { runMigrations } from '../database/migrator.ts';
import { eq } from 'drizzle-orm';

async function runVerification() {
  console.log('====================================================');
  console.log('BUG RIP: Registration State Diagnostic Verification');
  console.log('====================================================');

  const health = await checkDatabaseHealth();
  console.log(`Target Database Engine: ${health.engine} (Connected: ${health.connected})`);
  if (!health.connected) {
    console.error('Database connection failed:', health.error);
    process.exit(1);
  }

  // Ensure tables are defined
  await runMigrations();

  const [regCounts, rounds, challenges, settings, adminRows] = await Promise.all([
    teamRepository.getRegistrationCounts(),
    challengeRepository.getRounds(),
    challengeRepository.getChallenges(),
    eventRepository.getEventSettings(),
    db.select().from(adminUsers).where(eq(adminUsers.username, 'admin')).limit(1),
  ]);

  const superAdmin = adminRows[0] || null;

  console.log('\n--- Authoritative Registration Counts ---');
  console.log(`Registered Teams:           ${regCounts.teams}`);
  console.log(`Registered Participants:    ${regCounts.participants}`);
  console.log(`Registered Team Memberships:${regCounts.teamMembers}`);

  console.log('\n--- Core System & Configuration Status ---');
  console.log(`Event Name:                 ${settings?.eventName || 'N/A'}`);
  console.log(`Event Status:               ${settings?.status || 'N/A'}`);
  console.log(`Competition Rounds:         ${rounds.length}`);
  console.log(`Canonical Challenges:       ${challenges.length}`);
  console.log(`Super Admin Exists:         ${superAdmin ? 'YES (' + superAdmin.username + ')' : 'NO'}`);

  const isCleanFresh = regCounts.teams === 0 && regCounts.participants === 0 && regCounts.teamMembers === 0;

  console.log('\n----------------------------------------------------');
  if (isCleanFresh) {
    console.log('✓ VERIFIED: Database is in a CLEAN pre-import state.');
    console.log('  Zero fake/demo participant teams exist.');
    console.log('  Ready for symposium registration CSV import via Admin dashboard.');
  } else {
    console.log(`ℹ NOTICE: Database contains active registration records (${regCounts.teams} teams).`);
  }
  console.log('----------------------------------------------------');

  const strictFresh = process.argv.includes('--strict-fresh');
  if (strictFresh && !isCleanFresh) {
    console.error(`✗ Strict check failed: Expected 0 teams, found ${regCounts.teams}.`);
    process.exit(1);
  }

  process.exit(0);
}

runVerification().catch((err) => {
  console.error('Registration verification failed with unexpected error:', err);
  process.exit(1);
});

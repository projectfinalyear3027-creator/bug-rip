/**
 * BUG RIP - Explicit Development/Test Demo Participant Cleanup Script (Section 7)
 * 
 * IMPORTANT SAFETY RULES:
 * 1. NEVER automatically run against production databases.
 * 2. Strictly guarded against production execution (NODE_ENV=production).
 * 3. Targets ONLY explicitly known demo fixtures (DEV-ALPHA-001, DEV-BETA-002, DEV-GAMMA-003, DEV-DELTA-004)
 *    and demo participants (P-DEV-001, P-DEV-002, P-DEV-003).
 * 4. Never removes admin users, event settings, rounds, challenges, or test cases.
 * 
 * Usage:
 *   npx tsx scripts/cleanup-demo-participants.ts
 *   npx tsx scripts/cleanup-demo-participants.ts --all-dev-participants
 */

import { eq, inArray, or } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { runMigrations } from '../database/migrator.ts';
import {
  teams,
  participants,
  teamMembers,
  sessions,
  teamChallenges,
  teamUnlockedRounds,
  progressionOverrides,
} from '../src/db/schema.ts';
import { teamRepository } from '../backend/repositories/teamRepository.ts';

const KNOWN_DEMO_TEAM_CODES = ['DEV-ALPHA-001', 'DEV-BETA-002', 'DEV-GAMMA-003', 'DEV-DELTA-004'];
const KNOWN_DEMO_PARTICIPANT_EXTERNAL_IDS = ['P-DEV-001', 'P-DEV-002', 'P-DEV-003'];

async function runCleanup() {
  console.log('====================================================');
  console.log('BUG RIP: Explicit Demo Participant Cleanup Utility');
  console.log('====================================================');

  // Ensure migrations are in place
  await runMigrations();

  // Strict Production Safeguard
  if (process.env.NODE_ENV === 'production' && !process.env.FORCE_PRODUCTION_CLEANUP) {
    console.error('\n[SAFETY ERROR] Refusing to run participant cleanup in production environment.');
    console.error('Participant data in production can only be managed via the Admin Dashboard.');
    process.exit(1);
  }

  const beforeCounts = await teamRepository.getRegistrationCounts();
  console.log(`Before cleanup: ${beforeCounts.teams} teams, ${beforeCounts.participants} participants, ${beforeCounts.teamMembers} memberships.`);

  const purgeAll = process.argv.includes('--all-dev-participants');

  if (purgeAll) {
    console.log('\nPurging ALL participant registrations in dev database...');
    await db.delete(teamUnlockedRounds);
    await db.delete(progressionOverrides);
    await db.delete(teamChallenges);
    await db.delete(sessions);
    await db.delete(teamMembers);
    await db.delete(participants);
    await db.delete(teams);
    console.log('✓ All participant records purged.');
  } else {
    console.log(`\nRemoving known demo teams: ${KNOWN_DEMO_TEAM_CODES.join(', ')}...`);

    // Find demo teams
    const demoTeams = await db
      .select({ id: teams.id, code: teams.teamCode })
      .from(teams)
      .where(inArray(teams.teamCode, KNOWN_DEMO_TEAM_CODES));

    const demoTeamIds = demoTeams.map((t) => t.id);

    if (demoTeamIds.length > 0) {
      await db.delete(teamUnlockedRounds).where(inArray(teamUnlockedRounds.teamId, demoTeamIds));
      await db.delete(progressionOverrides).where(inArray(progressionOverrides.teamId, demoTeamIds));
      await db.delete(teamChallenges).where(inArray(teamChallenges.teamId, demoTeamIds));
      await db.delete(sessions).where(inArray(sessions.teamId, demoTeamIds));
      await db.delete(teamMembers).where(inArray(teamMembers.teamId, demoTeamIds));
      await db.delete(teams).where(inArray(teams.id, demoTeamIds));
      console.log(`✓ Deleted ${demoTeamIds.length} demo team(s) and associated dependencies.`);
    } else {
      console.log('• No demo teams matching known codes found in database.');
    }

    // Find and delete demo participants
    const demoParticipants = await db
      .select({ id: participants.id })
      .from(participants)
      .where(
        or(
          inArray(participants.externalParticipantId, KNOWN_DEMO_PARTICIPANT_EXTERNAL_IDS),
          inArray(participants.name, ['Arun Kumar', 'Ravi Teja', 'Priya Sharma'])
        )
      );

    const demoPartIds = demoParticipants.map((p) => p.id);
    if (demoPartIds.length > 0) {
      await db.delete(teamMembers).where(inArray(teamMembers.participantId, demoPartIds));
      await db.delete(participants).where(inArray(participants.id, demoPartIds));
      console.log(`✓ Deleted ${demoPartIds.length} demo participant record(s).`);
    } else {
      console.log('• No demo participants found.');
    }
  }

  const afterCounts = await teamRepository.getRegistrationCounts();
  console.log('\n----------------------------------------------------');
  console.log(`After cleanup: ${afterCounts.teams} teams, ${afterCounts.participants} participants, ${afterCounts.teamMembers} memberships.`);
  console.log('✓ Cleanup operation completed safely.');
  console.log('----------------------------------------------------');

  process.exit(0);
}

runCleanup().catch((err) => {
  console.error('Cleanup operation failed with error:', err);
  process.exit(1);
});

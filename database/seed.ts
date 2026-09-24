/**
 * BUG RIP - Development Database Seed Script
 * Populates non-production development data:
 * - Rounds (Easy, Medium, Hard, Extreme)
 * - Authoritative Event Settings (60 mins, 1-2 members)
 * - Development Teams & Participants (DEV-ALPHA-001, DEV-BETA-002)
 * - Initial Development Challenges, Test Cases & Flags
 * - Default Super Admin User
 */

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { db, schema, checkDatabaseHealth } from '../src/db/index.ts';
import {
  adminUsers,
  teams,
  participants,
  teamMembers,
  rounds,
  challenges,
  challengeTestCases,
  challengeFlags,
  eventSettings,
  competitionMatches,
  teamUnlockedRounds,
  progressionOverrides,
  teamChallenges,
  sessions,
} from '../src/db/schema.ts';
import { eq, inArray, or, notInArray } from 'drizzle-orm';
import { OFFICIAL_CHALLENGES, verifyChallengeInventoryIntegrity } from './challenges/index.ts';

export interface SeedOptions {
  /**
   * Explicitly enable development-only team and participant fixtures.
   * STRICTLY FORBIDDEN and IGNORED in production (process.env.NODE_ENV === 'production').
   * Default: false.
   */
  includeDemoParticipants?: boolean;
}

export async function runSeed(options?: SeedOptions) {
  console.log('----------------------------------------------------');
  console.log('BUG SNIPER: Executing Database Configuration Seed');
  console.log('----------------------------------------------------');

  const health = await checkDatabaseHealth();
  console.log(`Target Engine: ${health.engine} (Connected: ${health.connected})`);

  // 1. Seed Authoritative Event Settings
  console.log('Seeding Event Settings (60-minute Java Debugging CTF)...');
  await db
    .insert(eventSettings)
    .values({
      id: 1,
      eventName: 'BUG SNIPER',
      status: 'NOT_STARTED',
      durationMinutes: 60,
      minTeamMembers: 1,
      maxTeamMembers: 2,
      progressionMode: 'SEQUENTIAL',
      fullscreenRequired: false,
      liveScoreboardEnabled: true,
      showTeamMembersOnLive: true,
      showCurrentRoundOnLive: true,
      showTimerOnLive: true,
    })
    .onConflictDoUpdate({
      target: eventSettings.id,
      set: {
        eventName: 'BUG SNIPER',
        durationMinutes: 60,
        minTeamMembers: 1,
        maxTeamMembers: 2,
        progressionMode: 'SEQUENTIAL',
      },
    });

  // Ensure default Match 1 exists
  const existingMatches = await db
    .select()
    .from(competitionMatches)
    .where(eq(competitionMatches.matchNumber, 1))
    .limit(1);

  if (existingMatches.length === 0) {
    const [m1] = await db
      .insert(competitionMatches)
      .values({
        matchNumber: 1,
        name: 'Match 1',
        status: 'NOT_STARTED',
        durationMinutes: 60,
      })
      .returning();

    await db
      .update(eventSettings)
      .set({
        currentMatchNumber: 1,
        currentMatchId: m1.id,
      })
      .where(eq(eventSettings.id, 1));
  }

  // 2. Seed Rounds (Easy, Medium, Hard, Extreme)
  console.log('Seeding Competition Rounds...');
  const roundDefs = [
    {
      name: 'Easy',
      slug: 'easy',
      displayOrder: 1,
      unlockRequiredSolves: 0, // Unlocked by default
    },
    {
      name: 'Medium',
      slug: 'medium',
      displayOrder: 2,
      unlockRequiredSolves: 6, // 6 solves in Easy unlocks Medium
    },
    {
      name: 'Hard',
      slug: 'hard',
      displayOrder: 3,
      unlockRequiredSolves: 5, // 5 solves in Medium unlocks Hard
    },
    {
      name: 'Extreme',
      slug: 'extreme',
      displayOrder: 4,
      unlockRequiredSolves: 4, // 4 solves in Hard unlocks Extreme
    },
  ];

  const roundMap = new Map<string, string>();

  for (const r of roundDefs) {
    const existing = await db
      .select()
      .from(rounds)
      .where(eq(rounds.slug, r.slug))
      .limit(1);

    if (existing.length > 0) {
      roundMap.set(r.slug, existing[0].id);
    } else {
      const inserted = await db
        .insert(rounds)
        .values(r)
        .returning({ id: rounds.id, slug: rounds.slug });
      roundMap.set(inserted[0].slug, inserted[0].id);
    }
  }

  // 3. Seed Admin User
  console.log('Seeding Default Admin User...');
  const adminPasswordHash = await bcrypt.hash('BugRipAdmin2026!', 10);

  await db
    .insert(adminUsers)
    .values({
      username: 'admin',
      displayName: 'Tournament Director',
      passwordHash: adminPasswordHash,
      role: 'SUPER_ADMIN',
      isActive: true,
    })
    .onConflictDoUpdate({
      target: adminUsers.username,
      set: {
        passwordHash: adminPasswordHash,
        role: 'SUPER_ADMIN',
        isActive: true,
      },
    });

  // 4. Zero Demo Participant Teams Policy
  // Production and startup NEVER create demo participants.
  // Registration data enters solely through administrator Symposium CSV Import.
  // Actively purge any legacy demo teams or demo participants from persistent storage.
  const KNOWN_LEGACY_DEMO_CODES = ['DEV-ALPHA-001', 'DEV-BETA-002', 'DEV-GAMMA-003', 'DEV-DELTA-004'];
  const legacyDemoTeams = await db
    .select({ id: teams.id })
    .from(teams)
    .where(inArray(teams.teamCode, KNOWN_LEGACY_DEMO_CODES));

  if (legacyDemoTeams.length > 0) {
    const legacyIds = legacyDemoTeams.map((t) => t.id);
    await db.delete(teamUnlockedRounds).where(inArray(teamUnlockedRounds.teamId, legacyIds));
    await db.delete(progressionOverrides).where(inArray(progressionOverrides.teamId, legacyIds));
    await db.delete(teamChallenges).where(inArray(teamChallenges.teamId, legacyIds));
    await db.delete(sessions).where(inArray(sessions.teamId, legacyIds));
    await db.delete(teamMembers).where(inArray(teamMembers.teamId, legacyIds));
    await db.delete(teams).where(inArray(teams.id, legacyIds));
    console.log(`✓ Purged ${legacyIds.length} legacy demo team(s) from persistent storage.`);
  }

  const legacyDemoParts = await db
    .select({ id: participants.id })
    .from(participants)
    .where(
      or(
        inArray(participants.externalParticipantId, ['P-DEV-001', 'P-DEV-002', 'P-DEV-003']),
        inArray(participants.name, ['Arun Kumar', 'Ravi Teja', 'Priya Sharma'])
      )
    );

  if (legacyDemoParts.length > 0) {
    const legacyPartIds = legacyDemoParts.map((p) => p.id);
    await db.delete(teamMembers).where(inArray(teamMembers.participantId, legacyPartIds));
    await db.delete(participants).where(inArray(participants.id, legacyPartIds));
    console.log(`✓ Purged ${legacyPartIds.length} legacy demo participant(s) from persistent storage.`);
  }

  console.log('✓ Zero demo participant teams policy active: 0 fake teams created.');

  // Test-only fixtures injection strictly guarded by SEED_TEST_FIXTURES environment variable
  if (
    process.env.SEED_TEST_FIXTURES === 'true' &&
    process.env.NODE_ENV !== 'production' &&
    options?.includeDemoParticipants !== false
  ) {
    const { seedTestTeams } = await import('../tests/helpers/testFixtures.ts');
    await seedTestTeams();
    console.log('✓ Seeded test-only fixtures (1-2 members per team) for test execution.');
  }

  // 5. Seed Canonical Challenges Across Difficulty Tiers (Authoritative 45 Challenges: 15 Easy, 10 Med, 10 Hard, 10 Extreme)
  console.log('Validating and seeding Authoritative Challenge Inventory (45 Challenges)...');
  const integrity = verifyChallengeInventoryIntegrity();
  if (!integrity.valid) {
    throw new Error('Challenge inventory integrity check failed: ' + integrity.errors.join('; '));
  }
  console.log(`✓ Inventory verified: ${integrity.easyCount} Easy, ${integrity.mediumCount} Medium, ${integrity.hardCount} Hard, ${integrity.extremeCount} Extreme (${integrity.totalCount} total)`);

  const officialIds = OFFICIAL_CHALLENGES.map((c) => c.id);

  // Deactivate or purge any legacy/demo challenges that are not part of the official 45
  const nonOfficialChallenges = await db
    .select({ id: challenges.id })
    .from(challenges)
    .where(notInArray(challenges.id, officialIds));

  if (nonOfficialChallenges.length > 0) {
    const staleIds = nonOfficialChallenges.map((c) => c.id);
    console.log(`Purging ${staleIds.length} non-inventory challenge(s)...`);
    await db.delete(challengeTestCases).where(inArray(challengeTestCases.challengeId, staleIds));
    await db.delete(challengeFlags).where(inArray(challengeFlags.challengeId, staleIds));
    await db.delete(teamChallenges).where(inArray(teamChallenges.challengeId, staleIds));
    await db.delete(challenges).where(inArray(challenges.id, staleIds));
  }

  for (const c of OFFICIAL_CHALLENGES) {
    const roundId = roundMap.get(c.roundSlug);
    if (!roundId) {
      throw new Error(`Cannot seed challenge ${c.id}: round slug "${c.roundSlug}" not found in rounds table.`);
    }

    const flagVerifierHash = crypto.createHash('sha256').update(c.flag).digest('hex');

    await db
      .insert(challenges)
      .values({
        id: c.id,
        roundId,
        title: c.title,
        slug: c.slug,
        description: c.description,
        starterCode: c.starterCode,
        solutionCode: c.solutionCode,
        adminNotes: c.adminNotes,
        score: c.score,
        displayOrder: c.displayOrder,
        validationType: c.validationType,
        timeLimitMs: 3000,
        memoryLimitMb: 256,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: challenges.id,
        set: {
          roundId,
          title: c.title,
          slug: c.slug,
          description: c.description,
          starterCode: c.starterCode,
          solutionCode: c.solutionCode,
          adminNotes: c.adminNotes,
          score: c.score,
          displayOrder: c.displayOrder,
          validationType: c.validationType,
          isActive: true,
        },
      });

    // Flag verifier (never exposed via API)
    await db
      .insert(challengeFlags)
      .values({
        challengeId: c.id,
        flagVerifier: flagVerifierHash,
        flagMetadata: { algorithm: 'sha256' },
      })
      .onConflictDoUpdate({
        target: challengeFlags.challengeId,
        set: {
          flagVerifier: flagVerifierHash,
          flagMetadata: { algorithm: 'sha256' },
        },
      });

    // Clean prior test cases for this challenge to maintain clean, deduplicated, idempotent seed
    await db.delete(challengeTestCases).where(eq(challengeTestCases.challengeId, c.id));

    // Distinct public test cases
    for (let idx = 0; idx < c.publicTestCases.length; idx++) {
      const ptc = c.publicTestCases[idx];
      await db.insert(challengeTestCases).values({
        challengeId: c.id,
        testType: 'PUBLIC',
        inputData: ptc.inputData,
        expectedOutput: ptc.expectedOutput,
        explanation: ptc.explanation || 'Public behavioral validation test case',
        isHidden: false,
        displayOrder: idx + 1,
      });
    }

    // Hidden test cases (evaluated server-side only)
    for (let idx = 0; idx < c.hiddenTestCases.length; idx++) {
      const htc = c.hiddenTestCases[idx];
      await db.insert(challengeTestCases).values({
        challengeId: c.id,
        testType: 'HIDDEN',
        inputData: htc.inputData,
        expectedOutput: htc.expectedOutput,
        isHidden: true,
        displayOrder: idx + 1,
      });
    }
  }

  console.log(`✓ Seeded ${OFFICIAL_CHALLENGES.length} official challenges into database across all difficulty tiers.`);

  console.log('✓ Core configuration seed completed successfully (Rounds, Settings, Admin, Challenges).');
}

/**
 * DEPRECATED / REMOVED: Development participant seeding has been completely purged from BUG RIP core.
 * Registration data is populated exclusively through the real symposium CSV import workflow.
 */
export async function seedDevelopmentParticipants(): Promise<void> {
  throw new Error('SECURITY VIOLATION / DEMO PARTICIPANTS PURGED: Development participant seeding has been completely removed and is strictly prohibited in production and all environments.');
}

// Allow standalone execution via `tsx database/seed.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  runSeed()
    .then(() => {
      console.log('Seed process finished.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}

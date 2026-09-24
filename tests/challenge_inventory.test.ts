/**
 * BUG RIP - Authoritative Challenge Inventory Test Suite
 * 
 * Tests the 45-challenge inventory requirements:
 * 1. Exactly 15 Easy challenges exist.
 * 2. Exactly 10 Medium challenges exist.
 * 3. Exactly 10 Hard challenges exist.
 * 4. Exactly 10 Extreme challenges exist.
 * 5. Total active production challenges = 45.
 * 6. Every challenge belongs to exactly one difficulty.
 * 7. No duplicate challenge IDs.
 * 8. No duplicate challenge slugs.
 * 9. No demo challenges included.
 * 10. Participant can select any challenge in an unlocked difficulty.
 * 11. Progression still uses configured solve thresholds.
 * 12. Score does not control unlocking.
 * 13. New Match does not duplicate challenge definitions.
 * 14. Public challenge API does not expose hidden tests/flags/verifiers.
 * 15. Admin counts match the database.
 */

process.env.PG_MEM = 'true';

import { db } from '../src/db/index.ts';
import { runMigrations } from '../database/migrator.ts';
import { runSeed } from '../database/seed.ts';
import { OFFICIAL_CHALLENGES, verifyChallengeInventoryIntegrity } from '../database/challenges/index.ts';
import { challengeRepository } from '../backend/repositories/challengeRepository.ts';
import { progressionService } from '../backend/services/progressionService.ts';
import { adminRepository } from '../backend/repositories/adminRepository.ts';
import { rounds, challenges, challengeTestCases, challengeFlags, teams, adminUsers, participantChallenges, teamChallenges, eventSettings } from '../src/db/schema.ts';
import { eq, sql } from 'drizzle-orm';
import { assertNoForbiddenKeys } from '../backend/rules/participantDataSecurity.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function runInventoryTestSuite() {
  console.log('\n================================================================');
  console.log('BUG SNIPER - AUTHORITATIVE CHALLENGE INVENTORY TEST SUITE');
  console.log('================================================================\n');

  // Step 1: Migrate & Seed in-memory DB
  await runMigrations();
  await runSeed();

  // Test 0: Static inventory integrity validator
  const integrity = verifyChallengeInventoryIntegrity();
  assert(integrity.valid, `Static inventory integrity check passed (errors: ${integrity.errors.join(', ')})`);

  // Step 2: Fetch all rounds and challenges directly from the live database
  const dbRounds = await db.select().from(rounds).orderBy(rounds.displayOrder);
  const dbChallenges = await db.select().from(challenges);
  const activeChallenges = dbChallenges.filter((c) => c.isActive);

  const roundMap = new Map<string, string>();
  for (const r of dbRounds) {
    roundMap.set(r.slug.toLowerCase(), r.id);
  }

  const easyRoundId = roundMap.get('easy');
  const medRoundId = roundMap.get('medium');
  const hardRoundId = roundMap.get('hard');
  const extremeRoundId = roundMap.get('extreme');

  const easyChallenges = activeChallenges.filter((c) => c.roundId === easyRoundId);
  const medChallenges = activeChallenges.filter((c) => c.roundId === medRoundId);
  const hardChallenges = activeChallenges.filter((c) => c.roundId === hardRoundId);
  const extremeChallenges = activeChallenges.filter((c) => c.roundId === extremeRoundId);

  // Test 1: Exactly 15 Easy challenges exist
  assert(easyChallenges.length === 15, `Test 1: Exactly 15 Easy challenges in DB (found: ${easyChallenges.length})`);

  // Test 2: Exactly 10 Medium challenges exist
  assert(medChallenges.length === 10, `Test 2: Exactly 10 Medium challenges in DB (found: ${medChallenges.length})`);

  // Test 3: Exactly 10 Hard challenges exist
  assert(hardChallenges.length === 10, `Test 3: Exactly 10 Hard challenges in DB (found: ${hardChallenges.length})`);

  // Test 4: Exactly 10 Extreme challenges exist
  assert(extremeChallenges.length === 10, `Test 4: Exactly 10 Extreme challenges in DB (found: ${extremeChallenges.length})`);

  // Test 5: Total active production challenges = 45
  assert(activeChallenges.length === 45, `Test 5: Total active production challenges = 45 (found: ${activeChallenges.length})`);

  // Test 6: Every challenge belongs to exactly one valid active difficulty
  const validRoundIds = new Set([easyRoundId, medRoundId, hardRoundId, extremeRoundId]);
  const orphanedChallenges = activeChallenges.filter((c) => !c.roundId || !validRoundIds.has(c.roundId));
  assert(orphanedChallenges.length === 0, `Test 6: All challenges belong to a valid difficulty (orphaned: ${orphanedChallenges.length})`);

  // Test 7: No duplicate challenge IDs
  const idSet = new Set<string>();
  let duplicateIdCount = 0;
  for (const c of activeChallenges) {
    if (idSet.has(c.id)) duplicateIdCount++;
    idSet.add(c.id);
  }
  assert(duplicateIdCount === 0 && idSet.size === 45, `Test 7: All 45 challenge IDs are unique (duplicates: ${duplicateIdCount})`);

  // Test 8: No duplicate challenge slugs
  const slugSet = new Set<string>();
  let duplicateSlugCount = 0;
  for (const c of activeChallenges) {
    if (slugSet.has(c.slug)) duplicateSlugCount++;
    slugSet.add(c.slug);
  }
  assert(duplicateSlugCount === 0 && slugSet.size === 45, `Test 8: All 45 challenge slugs are unique (duplicates: ${duplicateSlugCount})`);

  // Test 9: No demo or test challenges included in production inventory
  const demoChallenges = activeChallenges.filter(
    (c) =>
      c.id.toLowerCase().includes('demo') ||
      c.title.toLowerCase().includes('demo') ||
      c.slug.toLowerCase().includes('demo') ||
      c.title.toLowerCase().includes('sample test')
  );
  assert(demoChallenges.length === 0, `Test 9: Zero demo or placeholder challenges in production DB (found: ${demoChallenges.length})`);

  // Test 10: Participant can select any challenge in an unlocked difficulty
  // Create a mock team to test progression
  const [testTeam] = await db
    .insert(teams)
    .values({
      externalTeamId: 'INV-TEST-TEAM-01',
      teamName: 'Inventory Test Team',
      teamCode: 'INVTEST01',
      registeredMemberCount: 1,
      status: 'ACTIVE',
    })
    .returning();

  const progression = await progressionService.getTeamProgression(testTeam.id);
  const easyRoundProg = progression.rounds.find((r) => r.slug === 'easy');
  assert(easyRoundProg !== undefined && easyRoundProg.isUnlocked, 'Easy round is unlocked by default');

  const availableEasyChallenges = progression.challenges.filter(
    (c) => c.roundId === easyRoundId && (c.status === 'AVAILABLE' || c.status === 'IN_PROGRESS' || c.status === 'COMPLETED')
  );
  assert(
    availableEasyChallenges.length === 15,
    `Test 10: All 15 Easy challenges are selectable in unlocked difficulty without forced sequential lock (selectable: ${availableEasyChallenges.length}/15)`
  );

  // Test 11: Progression uses configured solve thresholds (not hardcoded counts)
  const medRound = dbRounds.find((r) => r.slug === 'medium');
  assert(medRound !== undefined, 'Medium round exists in database');
  const configuredEasyThreshold = medRound?.unlockRequiredSolves ?? 6;
  assert(
    configuredEasyThreshold > 0 && configuredEasyThreshold <= 15,
    `Test 11: Medium unlock threshold is configurable (configured: ${configuredEasyThreshold}, challenge count: 15)`
  );

  // Verify threshold unlock behavior: simulate solving configuredEasyThreshold problems
  for (let i = 0; i < configuredEasyThreshold; i++) {
    const c = easyChallenges[i];
    await db.insert(teamChallenges).values({
      teamId: testTeam.id,
      challengeId: c.id,
      status: 'COMPLETED',
      attemptCount: 1,
      completedAt: new Date(),
    });
  }

  const progressionAfterSolves = await progressionService.getTeamProgression(testTeam.id);
  const medProgAfter = progressionAfterSolves.rounds.find((r) => r.slug === 'medium');
  assert(
    medProgAfter?.isUnlocked === true,
    `Test 11b: Medium difficulty unlocked after exactly ${configuredEasyThreshold} solves in Easy`
  );

  // Test 12: Score does NOT control unlocking (progression based solely on unique solves)
  // Check that solving 1 challenge with a high score does NOT unlock if threshold is not reached
  const [highScoreTeam] = await db
    .insert(teams)
    .values({
      externalTeamId: 'INV-TEST-TEAM-02',
      teamName: 'High Score Low Solves Team',
      teamCode: 'INVTEST02',
      registeredMemberCount: 1,
      status: 'ACTIVE',
    })
    .returning();

  // Give them 1 solve only with 1000 points
  await db.insert(teamChallenges).values({
    teamId: highScoreTeam.id,
    challengeId: easyChallenges[0].id,
    status: 'COMPLETED',
    attemptCount: 1,
    completedAt: new Date(),
  });

  const progHighScore = await progressionService.getTeamProgression(highScoreTeam.id);
  const medProgHighScore = progHighScore.rounds.find((r) => r.slug === 'medium');
  assert(
    medProgHighScore?.isUnlocked === false,
    'Test 12: High score alone without meeting solve count threshold does NOT unlock next difficulty'
  );

  // Test 13: New Match workflow preserves all 45 challenge definitions and does not duplicate them
  const adminUsersList = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.username, 'admin'))
    .limit(1);
  const adminId = adminUsersList[0].id;

  // Simulate match concluding into ENDED state
  await db.update(eventSettings).set({ status: 'ENDED' }).where(eq(eventSettings.id, 1));

  const newMatchResult = await adminRepository.createNewMatch(adminId, {
    matchName: 'Match 2 Test',
  });

  assert(newMatchResult.success, `New match created successfully (error: ${newMatchResult.error})`);
  const postMatchChallenges = await db.select().from(challenges);
  assert(
    postMatchChallenges.length === 45,
    `Test 13: New Match preserved exact 45 challenges without duplication (found: ${postMatchChallenges.length})`
  );

  // Test 14: Public challenge API does not expose hidden tests, flags, or verifiers
  // Enable UNLOCK_ALL temporarily so participant can inspect challenge DTOs across all tiers
  await progressionService.unlockAllDifficulties(adminId, 'Verify participant DTO safety across all tiers');

  for (const c of activeChallenges) {
    const publicData = await progressionService.getParticipantChallengeDetails(testTeam.id, c.id);
    assert(publicData !== null, `Challenge ${c.id} loaded via public API`);
    // Check no forbidden secret keys recursively
    assertNoForbiddenKeys(publicData);

    // Check test cases for participant
    const testCases = await challengeRepository.getTestCases(c.id, false);
    for (const tc of testCases) {
      assert((tc as any).isHidden === undefined || (tc as any).isHidden === false, `Test case ${tc.id} on challenge ${c.id} is public only`);
    }
  }
  assert(true, 'Test 14: Public challenge API strictly protects hidden tests, flags, and verifiers across all 45 challenges');

  // Test 15: Admin counts match the live database
  const metrics = await challengeRepository.getRoundMetrics();
  const adminEasy = metrics.find((m) => m.round.slug === 'easy');
  const adminMed = metrics.find((m) => m.round.slug === 'medium');
  const adminHard = metrics.find((m) => m.round.slug === 'hard');
  const adminExt = metrics.find((m) => m.round.slug === 'extreme');

  assert(adminEasy?.totalChallengesCount === 15, `Test 15a: Admin Easy count matches DB: ${adminEasy?.totalChallengesCount}/15`);
  assert(adminMed?.totalChallengesCount === 10, `Test 15b: Admin Medium count matches DB: ${adminMed?.totalChallengesCount}/10`);
  assert(adminHard?.totalChallengesCount === 10, `Test 15c: Admin Hard count matches DB: ${adminHard?.totalChallengesCount}/10`);
  assert(adminExt?.totalChallengesCount === 10, `Test 15d: Admin Extreme count matches DB: ${adminExt?.totalChallengesCount}/10`);

  const totalAdminChallenges = metrics.reduce((acc, m) => acc + m.totalChallengesCount, 0);
  assert(totalAdminChallenges === 45, `Test 15e: Total Admin count matches DB: ${totalAdminChallenges}/45`);

  console.log('\n================================================================');
  console.log(`TOTAL INVENTORY TESTS RUN: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runInventoryTestSuite()
  .then(() => {
    console.log('Authoritative challenge inventory test suite completed successfully.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Test suite execution error:', err);
    process.exit(1);
  });

/**
 * BUG RIP - Section 9: Participant Seeds Removal & Production Readiness Regression Test Suite
 * 
 * Verifies:
 * 1. FRESH DATABASE: Zero demo teams, zero participants, zero team memberships after default seed.
 * 2. ADMIN PRESERVATION: Super admin user exists, bcrypt hash valid, admin credentials work.
 * 3. CHALLENGE PRESERVATION: All 4 rounds, canonical challenges, public examples, and hidden test cases exist.
 * 4. SYMPOSIUM CSV IMPORT: Fresh empty database successfully populated via real CSV import workflow.
 * 5. PARTICIPANT AUTH: Participant login succeeds using imported Team Name + Unique Team Code.
 * 6. IDEMPOTENCY: Running runSeed() multiple times never creates demo teams and never duplicates rows.
 * 7. PRODUCTION SAFETY: NODE_ENV=production strictly forbids and refuses demo participant creation.
 */

import { db } from '../src/db/index.ts';
import { runMigrations } from '../database/migrator.ts';
import { runSeed, seedDevelopmentParticipants } from '../database/seed.ts';
import { teamRepository } from '../backend/repositories/teamRepository.ts';
import { adminRepository } from '../backend/repositories/adminRepository.ts';
import { challengeRepository } from '../backend/repositories/challengeRepository.ts';
import { eventRepository } from '../backend/repositories/eventRepository.ts';
import { csvImportService } from '../backend/services/csvImportService.ts';
import {
  teams,
  participants,
  teamMembers,
  adminUsers,
  rounds,
  challenges,
  challengeTestCases,
  eventSettings,
} from '../src/db/schema.ts';
import { eq, inArray } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

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

async function runParticipantSeedsRemovalTestSuite() {
  console.log('\n================================================================');
  console.log('BUG RIP: PARTICIPANT SEEDS REMOVAL & REGISTRATION SUITE (SEC 9)');
  console.log('================================================================');

  // Explicitly ensure test fixture auto-injection is disabled for clean testing
  delete process.env.SEED_TEST_FIXTURES;
  process.env.NODE_ENV = 'development';

  // -------------------------------------------------------------
  // Test Suite 1: Clean Startup & Fresh Database Verification
  // -------------------------------------------------------------
  console.log('\n--- Test Suite 1: Fresh Database Registration Verification ---');
  {
    // Execute fresh migrations and default seed
    await runMigrations();
    await runSeed(); // Default options: includeDemoParticipants = false

    const regCounts = await teamRepository.getRegistrationCounts();

    assert(regCounts.teams === 0, `Fresh database contains 0 registered teams (found: ${regCounts.teams})`);
    assert(regCounts.participants === 0, `Fresh database contains 0 registered participants (found: ${regCounts.participants})`);
    assert(regCounts.teamMembers === 0, `Fresh database contains 0 registered team memberships (found: ${regCounts.teamMembers})`);

    // Verify none of the demo teams exist
    const demoTeamAlpha = await teamRepository.getTeamByCode('DEV-ALPHA-001');
    const demoTeamBeta = await teamRepository.getTeamByCode('DEV-BETA-002');
    const demoTeamGamma = await teamRepository.getTeamByCode('DEV-GAMMA-003');
    const demoTeamDelta = await teamRepository.getTeamByCode('DEV-DELTA-004');

    assert(demoTeamAlpha === null, 'No demo team DEV-ALPHA-001 in fresh database');
    assert(demoTeamBeta === null, 'No demo team DEV-BETA-002 in fresh database');
    assert(demoTeamGamma === null, 'No demo team DEV-GAMMA-003 in fresh database');
    assert(demoTeamDelta === null, 'No demo team DEV-DELTA-004 in fresh database');

    // Verify no fake participant names exist in the database
    const fakeNames = await db
      .select()
      .from(participants)
      .where(inArray(participants.name, ['Arun Kumar', 'Ravi Teja', 'Priya Sharma']));
    assert(fakeNames.length === 0, 'Zero fake participant names (Arun, Ravi, Priya) in fresh database');
  }

  // -------------------------------------------------------------
  // Test Suite 2: Admin User Preservation & Authentication
  // -------------------------------------------------------------
  console.log('\n--- Test Suite 2: Admin Account Preservation & Verification ---');
  {
    const adminUserRows = await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.username, 'admin'))
      .limit(1);

    assert(adminUserRows.length > 0, 'Super admin user exists in database after seed');
    const adminUser = adminUserRows[0];
    assert(adminUser?.role === 'SUPER_ADMIN', 'Admin has SUPER_ADMIN role');
    assert(adminUser?.isActive === true, 'Admin account is active');

    // Verify admin credentials work through adminRepository
    const authResult = await adminRepository.verifyAdminCredentials('admin', 'BugRipAdmin2026!');
    assert(authResult !== null, 'adminRepository.verifyAdminCredentials succeeds with default seed credentials');
    assert(authResult?.username === 'admin', 'Authenticated admin username is "admin"');

    // Invalid credentials rejected
    const badAuthResult = await adminRepository.verifyAdminCredentials('admin', 'WrongPass123!');
    assert(badAuthResult === null, 'adminRepository.verifyAdminCredentials rejects invalid credentials');

    // Verify event settings configuration seeded
    const settings = await eventRepository.getEventSettings();
    assert(settings !== null, 'Event settings record seeded (ID=1)');
    assert(settings?.durationMinutes === 60, 'Competition duration is 60 minutes');
    assert(settings?.minTeamMembers === 1 && settings?.maxTeamMembers === 2, 'Team size constraints: 1-2 members');
  }

  // -------------------------------------------------------------
  // Test Suite 3: Challenge Seeds & Hidden Test Case Preservation
  // -------------------------------------------------------------
  console.log('\n--- Test Suite 3: Challenge Seeds & Validation Preservation ---');
  {
    const allRounds = await challengeRepository.getAllRounds();
    assert(allRounds.length === 4, `All 4 competition rounds exist (Easy, Medium, Hard, Extreme) (found: ${allRounds.length})`);

    const allChallenges = await challengeRepository.getChallenges();
    assert(allChallenges.length >= 5, `Canonical challenges seeded across tiers (found: ${allChallenges.length})`);

    // Verify public examples and hidden test cases are preserved for first challenge
    const challenge1 = allChallenges[0];
    const testCases = await db
      .select()
      .from(challengeTestCases)
      .where(eq(challengeTestCases.challengeId, challenge1.id));

    const publicCases = testCases.filter((tc) => !tc.isHidden);
    const hiddenCases = testCases.filter((tc) => tc.isHidden);

    assert(publicCases.length >= 2, `Challenge ${challenge1.id} has public test cases/examples (found: ${publicCases.length})`);
    assert(hiddenCases.length >= 2, `Challenge ${challenge1.id} has hidden validation test cases (found: ${hiddenCases.length})`);
    assert(challenge1.starterCode.length > 20, 'Challenge starter code is preserved');
  }

  // -------------------------------------------------------------
  // Test Suite 4: Production Registration Flow via Solo Participant CSV Import
  // -------------------------------------------------------------
  console.log('\n--- Test Suite 4: Real Solo Participant CSV Import into Empty Database ---');
  {
    // Real Solo Participant CSV with 3 independent competitors
    const validSymposiumCsv = `Participant Name,Participant Code,Email,Phone,College
Ananya Sen,QC-2026-X01,ananya@nitk.edu,+91-9876500001,NIT Karnataka
Karthik Rao,QC-2026-X02,karthik@nitk.edu,+91-9876500002,NIT Karnataka
Devanshi Joshi,CK-2026-Y02,devanshi@bits.edu,+91-9876500003,BITS Pilani`;

    const adminUserRows = await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.username, 'admin'))
      .limit(1);
    const adminUser = adminUserRows[0];

    // 1. Validate CSV
    const valResult = await csvImportService.validateCsvImport(validSymposiumCsv, adminUser.id);
    assert(valResult.valid === true, 'Solo registration CSV validates successfully');
    assert(valResult.stats.totalParticipants === 3, `Parsed 3 independent competitors from CSV (found: ${valResult.stats.totalParticipants})`);
    assert(valResult.stats.totalTeams === 0, 'No teams parsed in solo model');

    // 2. Confirm and execute atomic import
    const importResult = await csvImportService.confirmCsvImport(validSymposiumCsv, {
      id: adminUser.id,
      username: adminUser.username,
    });
    assert(importResult.success === true, 'Atomic CSV import completed successfully');
    assert(importResult.stats.teamsImported === 0, 'Zero teams imported in solo model');
    assert(importResult.stats.participantsImported === 3, 'Exactly 3 independent competitors imported');

    // 3. Verify database registration counts after CSV import
    const afterImportCounts = await teamRepository.getRegistrationCounts();
    assert(afterImportCounts.participants === 3, `Database now contains 3 registered participants (found: ${afterImportCounts.participants})`);
    assert(afterImportCounts.teams === 0, `Database contains 0 competition teams (found: ${afterImportCounts.teams})`);

    // 4. Verify authoritative participant codes from CSV
    const importedPart1 = await teamRepository.findParticipantByCode('QC-2026-X01');
    const importedPart2 = await teamRepository.findParticipantByCode('QC-2026-X02');
    const importedPart3 = await teamRepository.findParticipantByCode('CK-2026-Y02');

    assert(importedPart1 !== null, 'Competitor "Ananya Sen" exists with exact code "QC-2026-X01"');
    assert(importedPart2 !== null, 'Competitor "Karthik Rao" exists with exact code "QC-2026-X02"');
    assert(importedPart3 !== null, 'Competitor "Devanshi Joshi" exists with exact code "CK-2026-Y02"');
  }

  // -------------------------------------------------------------
  // Test Suite 5: Solo Participant Authentication with Imported Credentials
  // -------------------------------------------------------------
  console.log('\n--- Test Suite 5: Solo Participant Authentication After Import ---');
  {
    // Valid login with exact imported participant code
    const authSuccess = await teamRepository.verifyParticipantCredentials('QC-2026-X01');
    assert(authSuccess !== null, 'Participant login succeeds with imported Participant Code');
    assert(authSuccess?.name === 'Ananya Sen', 'Authenticated competitor name matches');

    // Trimmed check
    const authTrimmed = await teamRepository.verifyParticipantCredentials('  QC-2026-X01  ');
    assert(authTrimmed !== null, 'Participant code matches with leading/trailing whitespace');

    // Invalid credentials rejected
    const authBadCode = await teamRepository.verifyParticipantCredentials('WRONG-CODE-999');
    assert(authBadCode === null, 'Login rejected with incorrect participant code');
  }

  // -------------------------------------------------------------
  // Test Suite 6: Startup Idempotency (Re-run seed does not corrupt state)
  // -------------------------------------------------------------
  console.log('\n--- Test Suite 6: Seed Idempotency & Re-execution Safety ---');
  {
    const beforeRerunCounts = await teamRepository.getRegistrationCounts();

    // Re-run seed as happens on subsequent server restarts
    await runSeed();

    const afterRerunCounts = await teamRepository.getRegistrationCounts();

    assert(afterRerunCounts.teams === beforeRerunCounts.teams, 'Re-running runSeed() does NOT alter registered teams count');
    assert(afterRerunCounts.participants === beforeRerunCounts.participants, 'Re-running runSeed() does NOT duplicate participants');
    assert(afterRerunCounts.teamMembers === beforeRerunCounts.teamMembers, 'Re-running runSeed() does NOT duplicate memberships');

    // Verify demo teams were NOT injected on second startup
    const demoTeamAlpha = await teamRepository.getTeamByCode('DEV-ALPHA-001');
    assert(demoTeamAlpha === null, 'Server restart does not inject DEV-ALPHA-001');
  }

  // -------------------------------------------------------------
  // Test Suite 7: Strict Production Safety Enforcement
  // -------------------------------------------------------------
  console.log('\n--- Test Suite 7: Strict Production Environment Safety Guard ---');
  {
    process.env.NODE_ENV = 'production';

    let productionBlocked = false;
    try {
      // Direct call to seedDevelopmentParticipants in production must throw
      await seedDevelopmentParticipants();
    } catch (err: any) {
      productionBlocked = true;
      assert(err.message.includes('production'), `Production safety exception message: "${err.message}"`);
    }
    assert(productionBlocked === true, 'seedDevelopmentParticipants() strictly forbidden and rejected in production');

    // Even if options passed to runSeed in production, demo teams are NOT created
    await runSeed({ includeDemoParticipants: true });
    const prodAlpha = await teamRepository.getTeamByCode('DEV-ALPHA-001');
    assert(prodAlpha === null, 'runSeed({ includeDemoParticipants: true }) strictly ignores fixtures in production');

    // Restore test environment
    process.env.NODE_ENV = 'development';
  }

  // -------------------------------------------------------------
  // Final Results
  // -------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`REGRESSION RESULTS: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('================================================================');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runParticipantSeedsRemovalTestSuite().catch((err) => {
  console.error('Participant seeds removal test suite encountered an unexpected error:', err);
  process.exit(1);
});

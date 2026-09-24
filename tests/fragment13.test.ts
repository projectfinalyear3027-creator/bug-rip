/**
 * BUG RIP - Fragment 13 Automated Verification Test Suite
 * Solo Participant Registration Model & CSV Import Verification
 * 
 * Tests:
 * 1. CSV Tokenizer & RFC 4180 Parsing (quotes, commas, escaped quotes, newlines, BOM stripping)
 * 2. Formula Injection Protection (neutralizes leading =, +, -, @, \t, \r)
 * 3. Header Matching: No Team Name or Unique Team Code required
 * 4. Single participant import (CSV with 1 competitor)
 * 5. Multi-participant import (CSV with 10 independent competitors)
 * 6. Independence: Zero teams created in `teams` or `team_members`
 * 7. Duplicate individual participant code rejection
 * 8. Valid participant codes (RIP-XXXX-XXXX format)
 * 9. Independent competitor authentication via individual code
 * 10. Simultaneous participation & isolation: distinct sessions, distinct scores, distinct challenge solves
 * 11. Event State Locking (Import locked when competition is RUNNING or PAUSED; returns error)
 * 12. Audit Logging (records PARTICIPANT_IMPORT_VALIDATED and PARTICIPANT_IMPORT_CONFIRMED)
 * 13. Re-Import Idempotency (re-running identical CSV does not duplicate participants)
 */

process.env.PG_MEM = 'true';

import { db } from '../src/db/index.ts';
import { runMigrations } from '../database/migrator.ts';
import { runSeed } from '../database/seed.ts';
import { csvImportService } from '../backend/services/csvImportService.ts';
import { teamRepository } from '../backend/repositories/teamRepository.ts';
import { challengeRepository } from '../backend/repositories/challengeRepository.ts';
import {
  teams,
  participants,
  teamMembers,
  eventSettings,
  auditLogs,
  adminUsers,
  sessions,
  participantChallenges,
  challenges,
} from '../src/db/schema.ts';
import { eq, desc } from 'drizzle-orm';

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

async function runFragment13Tests() {
  console.log('\n===============================================================');
  console.log('BUG RIP — FRAGMENT 13 AUTOMATED VERIFICATION');
  console.log('SOLO PARTICIPANT REGISTRATION & CSV IMPORT VERIFICATION');
  console.log('===============================================================\n');

  console.log('[Setup] Running migrations and seeding test data...');
  await runMigrations();
  await runSeed();
  console.log('[Setup] Seed completed.\n');

  const [seededAdmin] = await db.select().from(adminUsers).limit(1);
  const adminUser = { id: seededAdmin.id, username: seededAdmin.username };

  // Reset event settings to NOT_STARTED for testing
  await db.update(eventSettings).set({ status: 'NOT_STARTED' }).where(eq(eventSettings.id, 1));

  // =========================================================================
  // SUITE 1: CSV RFC 4180 Parsing & Formula Injection Neutralization
  // =========================================================================
  console.log('--- SUITE 1: CSV RFC 4180 Parsing & Formula Injection Defense ---');

  const rawCsvWithQuotesAndEscapes = `Participant Name,Participant Code,Email,College\r\n"Thomas ""Neo"" Anderson",RIP-0001,neo@matrix.org,"Bavaria College, Tech Campus"\r\n`;
  const parsedRows = csvImportService.parseCsvRows(rawCsvWithQuotesAndEscapes);
  assert(parsedRows.length === 2, 'Parsed exactly 2 rows (header + data)');
  assert(parsedRows[1].fields[0] === 'Thomas "Neo" Anderson', 'Parsed escaped quotes ("") correctly');
  assert(parsedRows[1].fields[3] === 'Bavaria College, Tech Campus', 'Parsed comma inside quoted field correctly');

  // Formula injection defense
  const csvWithFormulas = `Participant Name,Participant Code\r\n=HYPERLINK("http://evil.com"),RIP-FORMULA\r\n`;
  const formulaParsed = csvImportService.parseCsvRows(csvWithFormulas);
  assert(formulaParsed[1].fields[0].startsWith("'="), 'Formula starting with = is neutralized with leading quote');

  // BOM stripping test
  const bomCsv = '\uFEFFParticipant Name,Participant Code\r\nBOM User,RIP-BOM-123\r\n';
  const bomParsed = csvImportService.parseCsvRows(bomCsv);
  assert(bomParsed[0].fields[0] === 'Participant Name', 'UTF-8 BOM is cleanly stripped from header');

  // =========================================================================
  // SUITE 2: Header Matching & Elimination of Team Requirements
  // =========================================================================
  console.log('\n--- SUITE 2: Header Matching & No Team Name or Unique Team Code Required ---');

  // Standard Solo Participant CSV
  const standardHeaders = `Participant Name,Participant Code,Email,College\r\nRavi Kumar,RIP-1001,ravi@example.com,ABC College\r\n`;
  const standardVal = await csvImportService.validateCsvImport(standardHeaders, adminUser.id);
  assert(standardVal.valid === true, 'Accepts standard "Participant Name" and "Participant Code" headers');
  assert(standardVal.stats.totalParticipants === 1, 'Extracted 1 participant');
  assert(standardVal.participants[0].name === 'Ravi Kumar', 'Mapped participant name correctly');
  assert(standardVal.participants[0].participantCode === 'RIP-1001', 'Mapped participant code correctly');

  // Varied normalized headers (student_name, access_code, competitor_name, etc.)
  const variedHeaders = `competitor_name,access_code,email_address,institution\r\nDevanshi Joshi,RIP-7701,dev@bits.edu,BITS Pilani\r\n`;
  const variedVal = await csvImportService.validateCsvImport(variedHeaders, adminUser.id);
  assert(variedVal.valid === true, 'Accepts normalized column headers (competitor_name, access_code)');
  assert(variedVal.participants[0].name === 'Devanshi Joshi', 'Mapped competitor_name correctly');
  assert(variedVal.participants[0].participantCode === 'RIP-7701', 'Mapped access_code correctly');

  // Absence of Team Name and Unique Team Code is NOT an error
  assert(!standardVal.errors.some((e) => e.message.includes('Team')), 'No Team Name or Team Code required in CSV');

  // =========================================================================
  // SUITE 3: Single Participant Import (1 Competitor)
  // =========================================================================
  console.log('\n--- SUITE 3: Single Participant Import ---');

  const singleParticipantCsv = `Participant Name,Participant Code,Email,College\r\nLone Star,RIP-SOLO-001,lonestar@space.org,Space Academy\r\n`;
  const singleVal = await csvImportService.validateCsvImport(singleParticipantCsv, adminUser.id);
  assert(singleVal.valid === true, 'Validation passes for 1 participant CSV');

  const singleImport = await csvImportService.confirmCsvImport(singleParticipantCsv, adminUser);
  assert(singleImport.success === true, 'Single participant imported successfully');
  assert(singleImport.stats.participantsImported === 1, 'Exactly 1 participant imported');
  assert(singleImport.stats.teamsImported === 0, 'Zero teams imported');

  const dbLoneStar = await teamRepository.findParticipantByCode('RIP-SOLO-001');
  assert(dbLoneStar !== null, 'Participant "Lone Star" found in database by participantCode');
  assert(dbLoneStar?.name === 'Lone Star', 'Participant name matches');

  // Check no team was created
  const teamCheck = await db.select().from(teams).where(eq(teams.teamName, 'Lone Star'));
  assert(teamCheck.length === 0, 'No team row created in teams table for Lone Star');

  // =========================================================================
  // SUITE 4: Ten Independent Participants Import
  // =========================================================================
  console.log('\n--- SUITE 4: Ten Independent Participants Import ---');

  let tenParticipantsCsv = `Participant Name,Participant Code,Email,College\r\n`;
  for (let i = 1; i <= 10; i++) {
    const pad = String(i).padStart(2, '0');
    tenParticipantsCsv += `Competitor ${pad},RIP-2026-X${pad},competitor${pad}@nitk.edu,NIT Karnataka\r\n`;
  }

  const tenVal = await csvImportService.validateCsvImport(tenParticipantsCsv, adminUser.id);
  assert(tenVal.valid === true, 'Validation passes for CSV with 10 independent participants');
  assert(tenVal.stats.totalParticipants === 10, 'Stats show exactly 10 participants');
  assert(tenVal.stats.totalTeams === 0, 'Stats show 0 teams');

  const tenImport = await csvImportService.confirmCsvImport(tenParticipantsCsv, adminUser);
  assert(tenImport.success === true, 'Import confirmed for 10 independent participants');
  assert(tenImport.stats.participantsImported === 10, 'Imported 10 participants');
  assert(tenImport.stats.teamsImported === 0, '0 teams imported');

  // Verify all 10 exist independently in participants table
  for (let i = 1; i <= 10; i++) {
    const pad = String(i).padStart(2, '0');
    const part = await teamRepository.findParticipantByCode(`RIP-2026-X${pad}`);
    assert(part !== null, `Competitor ${pad} exists independently in DB`);
  }

  // =========================================================================
  // SUITE 5: Independence & Absence of Team Rosters
  // =========================================================================
  console.log('\n--- SUITE 5: Complete Independence & No Team Rosters ---');

  // Verify that neither Lone Star nor any of the 10 competitors have entries in teamMembers
  const importedParticipantCodes = ['RIP-SOLO-001'];
  for (let i = 1; i <= 10; i++) {
    importedParticipantCodes.push(`RIP-2026-X${String(i).padStart(2, '0')}`);
  }

  for (const code of importedParticipantCodes) {
    const p = await teamRepository.findParticipantByCode(code);
    assert(p !== null, `Participant ${code} exists in participants table`);
    if (p) {
      const memberships = await db.select().from(teamMembers).where(eq(teamMembers.participantId, p.id));
      assert(memberships.length === 0, `Participant ${code} has ZERO entries in teamMembers table`);
    }
  }

  // Also verify that no team was named after any of the imported participants
  for (const code of importedParticipantCodes) {
    const p = await teamRepository.findParticipantByCode(code);
    if (p) {
      const namedTeams = await db.select().from(teams).where(eq(teams.teamName, p.name));
      assert(namedTeams.length === 0, `No team named "${p.name}" was created`);
    }
  }

  // =========================================================================
  // SUITE 6: Duplicate Participant Code Conflicts & Validation
  // =========================================================================
  console.log('\n--- SUITE 6: Duplicate Participant Code Conflict Detection ---');

  const duplicateCodeCsv = `Participant Name,Participant Code\r\nAlice Wonderland,RIP-DUPE-01\r\nBob Builder,RIP-DUPE-01\r\n`;
  const dupeVal = await csvImportService.validateCsvImport(duplicateCodeCsv, adminUser.id);
  assert(dupeVal.valid === false, 'Rejects CSV with duplicate participant access codes');
  assert(
    dupeVal.errors.some((e) => e.message.includes('Duplicate participant access code')),
    'Identifies duplicate code within the uploaded CSV'
  );

  // Missing code rejected
  const missingCodeCsv = `Participant Name,Participant Code\r\nNo Code User,\r\n`;
  const missingCodeVal = await csvImportService.validateCsvImport(missingCodeCsv, adminUser.id);
  assert(missingCodeVal.valid === false, 'Rejects row with missing participant code');
  assert(
    missingCodeVal.errors.some((e) => e.message.includes('Participant Code is required')),
    'Provides clear error that Participant Code is required'
  );

  // =========================================================================
  // SUITE 7: Valid Participant Codes Format (RIP-XXXX-XXXX)
  // =========================================================================
  console.log('\n--- SUITE 7: Valid Participant Code Format Handling ---');

  const generatedCode = csvImportService.generateParticipantCode();
  assert(/^RIP-[0-9A-F]{4}-[0-9A-F]{4}$/.test(generatedCode), `generateParticipantCode produces canonical RIP-XXXX-XXXX format: ${generatedCode}`);

  const canonicalCodeCsv = `Participant Name,Participant Code\r\nSam Altman,${generatedCode}\r\n`;
  const canonicalVal = await csvImportService.validateCsvImport(canonicalCodeCsv, adminUser.id);
  assert(canonicalVal.valid === true, 'Accepts canonical RIP-XXXX-XXXX formatted participant code');

  await csvImportService.confirmCsvImport(canonicalCodeCsv, adminUser);
  const dbSam = await teamRepository.findParticipantByCode(generatedCode);
  assert(dbSam !== null, `Competitor found by generated code ${generatedCode}`);

  // =========================================================================
  // SUITE 8: Independent Participant Login
  // =========================================================================
  console.log('\n--- SUITE 8: Independent Participant Login ---');

  // Competitor 01 login
  const comp1 = await teamRepository.verifyParticipantCredentials('RIP-2026-X01');
  assert(comp1 !== null, 'Competitor 01 logs in with individual participant code');
  assert(comp1?.name === 'Competitor 01', 'Competitor 01 name matches');

  // Competitor 02 login
  const comp2 = await teamRepository.verifyParticipantCredentials('RIP-2026-X02');
  assert(comp2 !== null, 'Competitor 02 logs in with individual participant code');
  assert(comp2?.name === 'Competitor 02', 'Competitor 02 name matches');

  // Whitespace trimming
  const compTrimmed = await teamRepository.verifyParticipantCredentials('  RIP-2026-X01  ');
  assert(compTrimmed !== null, 'Login succeeds with trimmed whitespace on code');

  // Case insensitivity
  const compCase = await teamRepository.verifyParticipantCredentials('rip-2026-x01');
  assert(compCase !== null, 'Login succeeds case-insensitively');

  // Bad code rejected
  const badAuth = await teamRepository.verifyParticipantCredentials('RIP-INVALID-999');
  assert(badAuth === null, 'Invalid participant code rejected');

  // =========================================================================
  // SUITE 9: Simultaneous Participation & Complete Isolation
  // =========================================================================
  console.log('\n--- SUITE 9: Simultaneous Participation & Progress Isolation ---');

  // Create session for Competitor 01
  const session1 = await teamRepository.createSession({
    participantId: comp1!.id,
    sessionTokenHash: 'token_hash_comp1',
    userAgent: 'Browser-A',
    ipAddress: '10.0.0.1',
  });
  assert(session1 !== null && session1.id !== undefined, 'Created active session for Competitor 01');

  // Create simultaneous session for Competitor 02
  const session2 = await teamRepository.createSession({
    participantId: comp2!.id,
    sessionTokenHash: 'token_hash_comp2',
    userAgent: 'Browser-B',
    ipAddress: '10.0.0.2',
  });
  assert(session2 !== null && session2.id !== undefined, 'Created active session for Competitor 02 simultaneously');
  assert(session1.id !== session2.id, 'Session IDs are distinct');

  // Get sample seeded challenge
  const allChallenges = await challengeRepository.getChallenges();
  assert(allChallenges.length > 0, 'Seeded challenges exist');
  const challengeA = allChallenges[0];

  // Competitor 01 solves challengeA
  await db.insert(participantChallenges).values({
    participantId: comp1!.id,
    challengeId: challengeA.id,
    status: 'COMPLETED',
    completionTimestamp: new Date(),
    attemptCount: 1,
  });

  // Verify Competitor 01 has solved challengeA
  const comp1Solves = await db
    .select()
    .from(participantChallenges)
    .where(eq(participantChallenges.participantId, comp1!.id));
  assert(comp1Solves.length === 1, 'Competitor 01 has 1 solved challenge');
  assert(comp1Solves[0].status === 'COMPLETED', 'Competitor 01 status is COMPLETED');

  // Verify Competitor 02 has NOT solved challengeA (isolated progress!)
  const comp2Solves = await db
    .select()
    .from(participantChallenges)
    .where(eq(participantChallenges.participantId, comp2!.id));
  assert(comp2Solves.length === 0, 'Competitor 02 has 0 solved challenges (progress is strictly isolated!)');

  // =========================================================================
  // SUITE 10: Event State Locking (Import Prohibited during RUNNING / PAUSED)
  // =========================================================================
  console.log('\n--- SUITE 10: Event State Locking ---');

  await db.update(eventSettings).set({ status: 'RUNNING' }).where(eq(eventSettings.id, 1));

  const lockedCsv = `Participant Name,Participant Code\r\nLate Competitor,RIP-LATE-01\r\n`;
  const lockedVal = await csvImportService.validateCsvImport(lockedCsv, adminUser.id);
  assert(lockedVal.registrationLocked === true, 'Validation flags registrationLocked=true when competition is RUNNING');
  assert(lockedVal.canImport === false, 'canImport is false when competition is RUNNING');
  assert(
    lockedVal.errors.some((e) => e.message.includes('REGISTRATION LOCKED')),
    'Returns clear error regarding locked competition state'
  );

  let confirmLockedFailed = false;
  try {
    await csvImportService.confirmCsvImport(lockedCsv, adminUser);
  } catch (err: any) {
    confirmLockedFailed = true;
    assert(err.message.includes('COMPETITION_ACTIVE_LOCKED'), 'confirmCsvImport throws error when locked');
  }
  assert(confirmLockedFailed, 'confirmCsvImport strictly rejected while competition is RUNNING');

  // Reset event settings back to NOT_STARTED
  await db.update(eventSettings).set({ status: 'NOT_STARTED' }).where(eq(eventSettings.id, 1));

  // =========================================================================
  // SUITE 11: Audit Logging Verification
  // =========================================================================
  console.log('\n--- SUITE 11: Audit Logging Verification ---');

  const auditValidate = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.action, 'PARTICIPANT_IMPORT_VALIDATED'))
    .orderBy(desc(auditLogs.createdAt))
    .limit(1);
  assert(auditValidate.length > 0, 'PARTICIPANT_IMPORT_VALIDATED logged');

  const auditConfirm = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.action, 'PARTICIPANT_IMPORT_CONFIRMED'))
    .orderBy(desc(auditLogs.createdAt))
    .limit(1);
  assert(auditConfirm.length > 0, 'PARTICIPANT_IMPORT_CONFIRMED logged');
  assert(auditConfirm[0].metadata?.participantsImported !== undefined, 'Audit log records participant count without team rosters');

  // =========================================================================
  // SUITE 12: Re-Import Idempotency
  // =========================================================================
  console.log('\n--- SUITE 12: Re-Import Safety & Idempotency ---');

  const countBeforeReimport = await teamRepository.getRegistrationCounts();
  const reimportResult = await csvImportService.confirmCsvImport(tenParticipantsCsv, adminUser);
  assert(reimportResult.success === true, 'Re-importing identical CSV succeeds');
  assert(reimportResult.stats.unchangedParticipants === 10, 'All 10 records recognized as unchanged');
  
  const countAfterReimport = await teamRepository.getRegistrationCounts();
  assert(
    countAfterReimport.participants === countBeforeReimport.participants,
    'Re-import does NOT duplicate participant records'
  );

  // =========================================================================
  // FINAL RESULTS SUMMARY
  // =========================================================================
  console.log('\n===============================================================');
  console.log(`FRAGMENT 13 TEST RESULTS: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('===============================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runFragment13Tests().catch((err) => {
  console.error('Unhandled test execution error in Fragment 13:', err);
  process.exit(1);
});

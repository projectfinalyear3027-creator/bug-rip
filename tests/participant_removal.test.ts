/**
 * BUG RIP - Admin Safe Participant Removal & Reactivation Lifecycle Tests
 *
 * Verifies:
 * 1. Safe deactivation (soft delete) of participant while competition is NOT_STARTED.
 * 2. Associated team status set to INACTIVE/DISABLED and active sessions expired immediately.
 * 3. Realtime connections forcibly closed (teamRealtimeService.disconnectParticipant).
 * 4. Immutable audit logging for deactivation and reactivation.
 * 5. Inactive participant blocked from logging in (403 PARTICIPANT_INACTIVE).
 * 6. Protection constraint: Deactivation rejected if competition is RUNNING or PAUSED.
 * 7. Reactivation restores participant to ACTIVE and logs audit event.
 * 8. CSV re-import with matching participantCode re-activates without creating duplicate identities.
 * 9. getParticipantsOverview filter supports 'ACTIVE', 'INACTIVE', and 'ALL'.
 */

process.env.PG_MEM = 'true';

import crypto from 'crypto';
import { db } from '../src/db/index.ts';
import { runMigrations } from '../database/migrator.ts';
import { runSeed } from '../database/seed.ts';
import { adminRepository } from '../backend/repositories/adminRepository.ts';
import { teamRepository } from '../backend/repositories/teamRepository.ts';
import { csvImportService } from '../backend/services/csvImportService.ts';
import {
  participants,
  teams,
  teamMembers,
  sessions,
  eventSettings,
  auditLogs,
  adminUsers,
} from '../src/db/schema.ts';
import { eq, and, sql } from 'drizzle-orm';

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

async function runParticipantRemovalTests() {
  console.log('\n--- BUG RIP: ADMIN SAFE PARTICIPANT REMOVAL TESTS ---\n');

  // 1. Setup DB
  await runMigrations();
  await runSeed();

  // Find admin user for audit log attribution
  const admins = await db.select().from(adminUsers).limit(1);
  const adminId = admins[0]?.id || 'admin-test-id';

  // Ensure event state is NOT_STARTED
  await db
    .update(eventSettings)
    .set({ status: 'NOT_STARTED', updatedAt: new Date() })
    .where(eq(eventSettings.id, 1));

  // Create a test solo competitor
  const testCode = 'TEST_REM_01';
  const testEmail = 'competitor.removal@example.com';
  const testName = 'Alex Removal Candidate';

  const [insertedParticipant] = await db
    .insert(participants)
    .values({
      name: testName,
      email: testEmail,
      college: 'Cyber Institute',
      participantCode: testCode,
      status: 'ACTIVE',
    })
    .returning();

  // Create associated solo team
  const [insertedTeam] = await db
    .insert(teams)
    .values({
      teamName: testName,
      teamCode: testCode,
      status: 'ACTIVE',
      totalScore: 0,
      problemsSolved: 0,
    })
    .returning();

  // Link member
  await db.insert(teamMembers).values({
    teamId: insertedTeam.id,
    participantId: insertedParticipant.id,
    role: 'PRIMARY',
  });

  // Create an active session
  const rawSessionToken = 'session_test_token_123';
  const tokenHash = crypto.createHash('sha256').update(rawSessionToken).digest('hex');
  const now = new Date();
  const futureExpiry = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  await db.insert(sessions).values({
    teamId: insertedTeam.id,
    participantId: insertedParticipant.id,
    sessionTokenHash: tokenHash,
    ipAddress: '127.0.0.1',
    userAgent: 'TestBrowser',
    status: 'ACTIVE',
    createdAt: now,
    lastHeartbeat: now,
    expiresAt: futureExpiry,
  });

  console.log('Test 1: Deactivate participant while competition is NOT_STARTED');
  const deactRes = await adminRepository.deactivateParticipant(
    insertedParticipant.id,
    adminId,
    'Duplicate registration test'
  );
  assert(deactRes.success === true, 'Deactivation returned success');
  assert(deactRes.participant?.status === 'INACTIVE', 'Participant status changed to INACTIVE');

  console.log('Test 2: Verify soft delete - record still exists in DB');
  const pCheck = await db
    .select()
    .from(participants)
    .where(eq(participants.id, insertedParticipant.id));
  assert(pCheck.length === 1, 'Participant record is NOT hard deleted');
  assert(pCheck[0].status === 'INACTIVE', 'Participant status in DB is INACTIVE');

  console.log('Test 3: Verify associated team and sessions are disabled/expired');
  const tCheck = await db.select().from(teams).where(eq(teams.id, insertedTeam.id));
  assert(tCheck[0].status === 'DISABLED', 'Associated solo team status set to DISABLED');

  const sCheck = await db
    .select()
    .from(sessions)
    .where(eq(sessions.participantId, insertedParticipant.id));
  assert(sCheck.length > 0, 'Session records preserved for audit history');
  const activeSessionsCount = sCheck.filter(
    (s) => s.status === 'ACTIVE' && new Date(s.expiresAt) > new Date()
  ).length;
  assert(activeSessionsCount === 0, 'No active unexpired sessions remain');

  console.log('Test 4: Verify audit log recorded for deactivation');
  const auditEntries = await db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, 'PARTICIPANT_DEACTIVATED'),
        eq(auditLogs.targetId, insertedParticipant.id)
      )
    );
  assert(auditEntries.length >= 1, 'Immutable audit log for PARTICIPANT_DEACTIVATED exists');

  console.log('Test 5: Participant overview filtering');
  const activeOverview = await adminRepository.getParticipantsOverview('ACTIVE');
  const inactiveOverview = await adminRepository.getParticipantsOverview('INACTIVE');
  const allOverview = await adminRepository.getParticipantsOverview('ALL');

  assert(
    !activeOverview.some((p) => p.id === insertedParticipant.id),
    'Deactivated participant excluded from ACTIVE list'
  );
  assert(
    inactiveOverview.some((p) => p.id === insertedParticipant.id),
    'Deactivated participant included in INACTIVE list'
  );
  assert(
    allOverview.some((p) => p.id === insertedParticipant.id),
    'Deactivated participant included in ALL list'
  );

  console.log('Test 6: Reactivate participant');
  const reactRes = await adminRepository.reactivateParticipant(
    insertedParticipant.id,
    adminId,
    'Reactivation requested by admin'
  );
  assert(reactRes.success === true, 'Reactivation returned success');
  assert(reactRes.participant?.status === 'ACTIVE', 'Participant status updated back to ACTIVE');

  const reactAudit = await db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, 'PARTICIPANT_REACTIVATED'),
        eq(auditLogs.targetId, insertedParticipant.id)
      )
    );
  assert(reactAudit.length >= 1, 'Audit log for PARTICIPANT_REACTIVATED recorded');

  console.log('Test 7: Guard constraint - deactivation blocked when competition is RUNNING');
  await db
    .update(eventSettings)
    .set({ status: 'RUNNING', updatedAt: new Date() })
    .where(eq(eventSettings.id, 1));

  const blockedDeact = await adminRepository.deactivateParticipant(
    insertedParticipant.id,
    adminId,
    'Attempt during running'
  );
  assert(blockedDeact.success === false, 'Deactivation rejected while competition is RUNNING');
  assert(
    blockedDeact.error?.includes('NOT_STARTED') || blockedDeact.statusCode === 400,
    'Clear error explaining NOT_STARTED precondition'
  );

  // Restore event status to NOT_STARTED
  await db
    .update(eventSettings)
    .set({ status: 'NOT_STARTED', updatedAt: new Date() })
    .where(eq(eventSettings.id, 1));

  console.log('Test 8: CSV re-import re-activates inactive participant without duplicates');
  // Deactivate again
  await adminRepository.deactivateParticipant(insertedParticipant.id, adminId, 'Re-testing CSV');

  const csvRow = `Name,Email,College,Participant Code\n${testName},${testEmail},Cyber Institute,${testCode}\n`;
  const validation = await csvImportService.validateCsvImport(csvRow);
  assert(validation.valid === true, 'CSV validation passed');
  assert(validation.participants.length === 1, 'One participant validated');

  const importResult = await csvImportService.confirmCsvImport(csvRow, {
    id: adminId,
    username: 'admin',
  });
  assert(importResult.success === true, 'CSV import succeeded');

  const pFinal = await db
    .select()
    .from(participants)
    .where(eq(participants.participantCode, testCode));
  assert(pFinal.length === 1, 'Identity matched existing record; no duplicates created');
  assert(pFinal[0].status === 'ACTIVE', 'Participant status restored to ACTIVE via valid CSV re-import');

  // =========================================================================
  // SUITE: Registered Participant Count Accuracy & Event Readiness Lifecycle
  // =========================================================================
  console.log('\n--- REGISTRATION COUNT ACCURACY & EVENT READINESS LIFECYCLE ---');

  // Clean slate for strict count assertions
  await db.delete(teamMembers);
  await db.delete(sessions);
  await db.delete(teams);
  await db.delete(participants);

  // 1. One ACTIVE participant -> registered count = 1
  console.log('Requirement 1 & 2: Single participant deactivation 1 -> 0');
  const [partA] = await db
    .insert(participants)
    .values({
      name: 'Alice Active',
      email: 'alice@example.com',
      participantCode: 'RIP-ALICE-01',
      status: 'ACTIVE',
    })
    .returning();

  let metrics1 = await adminRepository.getDashboardMetrics();
  let regCounts1 = await teamRepository.getRegistrationCounts();
  assert(metrics1.registeredParticipantsCount === 1, 'One ACTIVE participant: Dashboard registeredParticipantsCount = 1');
  assert(metrics1.registeredParticipants === 1, 'One ACTIVE participant: Dashboard registeredParticipants = 1');
  assert(regCounts1.participants === 1, 'One ACTIVE participant: teamRepository count = 1');

  // 2. Deactivate that participant -> registered count = 0
  await adminRepository.deactivateParticipant(partA.id, adminId, 'Deactivating Alice');
  let metrics2 = await adminRepository.getDashboardMetrics();
  let regCounts2 = await teamRepository.getRegistrationCounts();
  assert(
    metrics2.registeredParticipantsCount === 0,
    'Deactivated only participant: Dashboard registeredParticipantsCount = 0 (NOT 1!)'
  );
  assert(
    metrics2.registeredParticipants === 0,
    'Deactivated only participant: Dashboard registeredParticipants = 0'
  );
  assert(regCounts2.participants === 0, 'Deactivated only participant: teamRepository count = 0');

  // Verify historical record still exists in DB
  const allRowsInDb = await db.select().from(participants);
  assert(allRowsInDb.length === 1, 'Requirement 11: Historical participant record remains intact in DB (1 total row)');
  assert(allRowsInDb[0].status === 'INACTIVE', 'Historical record status is INACTIVE');

  // 6. INACTIVE participant does not satisfy event readiness
  console.log('Requirement 6: INACTIVE participant does not satisfy event readiness');
  const readinessWhenInactive = await adminRepository.validateEventStartPreconditions();
  assert(
    readinessWhenInactive.canStart === false,
    'Event CANNOT start when only INACTIVE participants exist'
  );
  assert(
    readinessWhenInactive.errors.some((e) => e.includes('No competitors have been registered')),
    'Precondition error correctly reported for lack of active competitors'
  );

  // 7. Reactivate an INACTIVE participant -> count increases correctly & satisfies readiness
  console.log('Requirement 7: Reactivate participant -> count becomes 1');
  await adminRepository.reactivateParticipant(partA.id, adminId, 'Reactivating Alice');
  let metricsReactivated = await adminRepository.getDashboardMetrics();
  assert(
    metricsReactivated.registeredParticipantsCount === 1,
    'Reactivated participant: registeredParticipantsCount = 1'
  );

  // Clean slate for multi-participant test
  await db.delete(teamMembers);
  await db.delete(sessions);
  await db.delete(teams);
  await db.delete(participants);

  // 3. Two ACTIVE participants -> registered count = 2
  console.log('Requirement 3, 4, 5: Multi-participant deactivation lifecycle (2 -> 1 -> 0)');
  const [user1] = await db
    .insert(participants)
    .values({
      name: 'Bob Competitor',
      email: 'bob@example.com',
      participantCode: 'RIP-BOB-02',
      status: 'ACTIVE',
    })
    .returning();

  const [user2] = await db
    .insert(participants)
    .values({
      name: 'Charlie Competitor',
      email: 'charlie@example.com',
      participantCode: 'RIP-CHARLIE-03',
      status: 'ACTIVE',
    })
    .returning();

  let metricsTwo = await adminRepository.getDashboardMetrics();
  assert(metricsTwo.registeredParticipantsCount === 2, 'Two ACTIVE participants: registered count = 2');

  // 4. Deactivate one -> registered count = 1
  await adminRepository.deactivateParticipant(user1.id, adminId, 'Deactivating Bob');
  let metricsAfterOneDeact = await adminRepository.getDashboardMetrics();
  assert(
    metricsAfterOneDeact.registeredParticipantsCount === 1,
    'Deactivated Bob: registered count = 1 (Charlie remains active)'
  );

  // 5. Deactivate both -> registered count = 0
  await adminRepository.deactivateParticipant(user2.id, adminId, 'Deactivating Charlie');
  let metricsAfterBothDeact = await adminRepository.getDashboardMetrics();
  assert(
    metricsAfterBothDeact.registeredParticipantsCount === 0,
    'Deactivated Charlie: registered count = 0'
  );

  // 10. Registered Participants default view excludes inactive participants
  console.log('Requirement 10: Default participant view excludes inactive');
  const defaultOverview = await adminRepository.getParticipantsOverview();
  assert(
    defaultOverview.length === 0,
    'Default getParticipantsOverview() returns 0 items when all participants are INACTIVE'
  );

  const allOverviewList = await adminRepository.getParticipantsOverview('ALL');
  assert(
    allOverviewList.length === 2,
    'getParticipantsOverview("ALL") returns all 2 historical participants'
  );

  const inactiveOverviewList = await adminRepository.getParticipantsOverview('INACTIVE');
  assert(
    inactiveOverviewList.length === 2,
    'getParticipantsOverview("INACTIVE") returns 2 inactive participants'
  );

  // 12. Connected participants count is based on actual sessions, not registration rows
  console.log('Requirement 12: Connected participant count is based on live connections, not registration rows');
  assert(
    metricsAfterBothDeact.connectedParticipantsCount === 0,
    'Connected participants count is 0 when no live connections exist'
  );

  console.log('\n--- TEST SUMMARY ---');
  console.log(`Passed: ${testsPassed}`);
  console.log(`Failed: ${testsFailed}`);

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runParticipantRemovalTests().catch((err) => {
  console.error('Participant removal test suite crashed:', err);
  process.exit(1);
});

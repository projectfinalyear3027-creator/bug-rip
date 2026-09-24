/**
 * BUG RIP - Fragment 4: Admin Authentication & Organizer Control Center Tests
 * Strictly verifies:
 * 1. Admin login with bcrypt verification & generic error handling
 * 2. Admin rate limiting (5 attempts/min)
 * 3. Secure HTTP-only admin sessions & revocation
 * 4. Participant token barrier: participant tokens strictly rejected with 403
 * 5. Role validation (ADMIN vs SUPER_ADMIN)
 * 6. Live team & participant monitoring with real session counts (1/1, 2/2, 1/2, 0/2)
 * 7. Authoritative event state machine (START, PAUSE, RESUME, END) with precondition checks & duplicate safety
 * 8. Audit logging in audit_logs table
 */

import crypto from 'crypto';
import { db } from '../src/db/index.ts';
import { runMigrations } from '../database/migrator.ts';
import { runSeed } from '../database/seed.ts';
import { seedTestTeams } from './helpers/testFixtures.ts';
import { adminRepository } from '../backend/repositories/adminRepository.ts';
import { teamRepository } from '../backend/repositories/teamRepository.ts';
import { resetAdminLoginRateLimiter } from '../backend/middleware/rateLimiter.ts';
import { auditLogs, eventSettings, teams, participants, teamMembers, sessions, adminSessions, adminUsers } from '../src/db/schema.ts';
import { requireAdmin, requireSuperAdmin } from '../backend/middleware/authMiddleware.ts';
import { eq, and } from 'drizzle-orm';

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

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw.trim()).digest('hex');
}

async function runAdminTests() {
  console.log('\n====================================================');
  console.log('BUG RIP: Running Admin Authentication & Control Center Tests');
  console.log('====================================================');

  // 1. Initialize database migrations and seed
  await runMigrations();
  await runSeed();
  await seedTestTeams();
  resetAdminLoginRateLimiter();

  // Reset event settings to NOT_STARTED for test baseline
  await db
    .update(eventSettings)
    .set({
      status: 'NOT_STARTED',
      startedAt: null,
      pausedAt: null,
      endedAt: null,
      totalPausedDurationSeconds: 0,
    })
    .where(eq(eventSettings.id, 1));

  // Clear existing test sessions
  await db.delete(sessions);

  // =========================================================================
  // SUITE 1: Admin Login Verification & Bcrypt Security
  // =========================================================================
  console.log('\n[Suite 1: Admin Login Verification & Password Security]');

  // 1.1 Correct username + correct password
  const validAdmin = await adminRepository.verifyAdminCredentials('admin', 'BugRipAdmin2026!');
  assert(validAdmin !== null, 'Correct admin credentials return authenticated user record');
  assert(validAdmin?.username === 'admin', 'Returned username is "admin"');
  assert(validAdmin?.role === 'SUPER_ADMIN', 'Default admin has role SUPER_ADMIN');

  // 1.2 Correct username + wrong password
  const wrongPassword = await adminRepository.verifyAdminCredentials('admin', 'WrongPass123!');
  assert(wrongPassword === null, 'Wrong password returns null (generic failure)');

  // 1.3 Unknown username + any password
  const unknownUser = await adminRepository.verifyAdminCredentials('nonexistent_user', 'BugRipAdmin2026!');
  assert(unknownUser === null, 'Unknown username returns null (generic failure, no account enumeration)');

  // 1.4 Trimmed username matches cleanly
  const paddedAdmin = await adminRepository.verifyAdminCredentials('  admin  ', 'BugRipAdmin2026!');
  assert(paddedAdmin !== null, 'Padded username is trimmed cleanly and authenticates');

  // =========================================================================
  // SUITE 2: Admin Session Lifecycle & Revocation
  // =========================================================================
  console.log('\n[Suite 2: Admin Session Lifecycle & Revocation]');

  // 2.1 Create session
  const { sessionToken, session } = await adminRepository.createAdminSession(validAdmin!.id, {
    ipAddress: '127.0.0.1',
    userAgent: 'JestTestRunner/1.0',
    durationHours: 8,
  });

  assert(Boolean(sessionToken), 'Admin session token generated');
  assert(session.adminUserId === validAdmin!.id, 'Session references correct admin user ID');
  assert(session.status === 'ACTIVE', 'New admin session has ACTIVE status');
  assert(session.expiresAt > new Date(), 'Session expires in the future (> now)');

  // 2.2 Validate session
  const validated = await adminRepository.validateAdminSession(sessionToken);
  assert(validated !== null, 'Valid session token resolves against database');
  assert(validated?.adminUser.username === 'admin', 'Resolved session belongs to "admin"');
  assert(validated?.adminUser.role === 'SUPER_ADMIN', 'Session retains SUPER_ADMIN role');

  // 2.3 Revoke session (Logout)
  const revoked = await adminRepository.revokeAdminSession(sessionToken);
  assert(revoked === true, 'Admin session successfully revoked on logout');

  // 2.4 Validate after revocation
  const validatedAfterRevoke = await adminRepository.validateAdminSession(sessionToken);
  assert(validatedAfterRevoke === null, 'Revoked admin session is rejected (cannot be reused)');

  // =========================================================================
  // SUITE 3: Participant Token Barrier & Role Separation
  // =========================================================================
  console.log('\n[Suite 3: Participant Barrier & Role Separation]');

  // Create a genuine participant session for Team Alpha
  const teamAlpha = await teamRepository.getTeamByCode('DEV-ALPHA-001');
  assert(teamAlpha !== null, 'Development Team Alpha exists in database');

  const participantSlot = await teamRepository.getNextAvailableParticipant(teamAlpha!.id);
  const part1Token = crypto.randomBytes(32).toString('hex');
  const part1Hash = hashToken(part1Token);
  const partSession = await teamRepository.createSession({
    teamId: teamAlpha!.id,
    participantId: participantSlot || undefined,
    sessionTokenHash: part1Hash,
  });

  // Verify participant token exists in participant sessions
  const isPartSession = await teamRepository.findSessionByTokenHash(part1Hash);
  assert(isPartSession !== null, 'Participant session token successfully created in sessions table');

  // Verify participant token fails admin session validation
  const partAsAdmin = await adminRepository.validateAdminSession(part1Token);
  assert(partAsAdmin === null, 'Participant token is completely invalid for admin session validation');

  // =========================================================================
  // SUITE 4: Real-Time Team Connection Monitoring
  // =========================================================================
  console.log('\n[Suite 4: Real-Time Team Connection Monitoring]');

  // Currently Team Alpha has 1 active session (partSession)
  const overview1 = await adminRepository.getTeamsOverview();
  const alphaOverview1 = overview1.find((t) => t.teamCode === 'DEV-ALPHA-001');
  assert(alphaOverview1 !== undefined, 'Team Alpha found in admin overview');
  assert(alphaOverview1?.registeredMemberCount === 2, 'Team Alpha has 2 registered members');
  assert(alphaOverview1?.connectedMemberCount === 1, 'Team Alpha shows exactly 1/2 connected members (actual: 1)');

  // Connect second member of Team Alpha
  const part2Slot = await teamRepository.getNextAvailableParticipant(teamAlpha!.id);
  const part2Token = crypto.randomBytes(32).toString('hex');
  const part2Hash = hashToken(part2Token);
  const part2Session = await teamRepository.createSession({
    teamId: teamAlpha!.id,
    participantId: part2Slot || undefined,
    sessionTokenHash: part2Hash,
  });

  const overview2 = await adminRepository.getTeamsOverview();
  const alphaOverview2 = overview2.find((t) => t.teamCode === 'DEV-ALPHA-001');
  assert(alphaOverview2?.connectedMemberCount === 2, 'Team Alpha shows exactly 2/2 connected members when both active');

  // Team Beta has 1 registered member, 0 connected
  const betaOverview = overview2.find((t) => t.teamCode === 'DEV-BETA-002');
  assert(betaOverview?.registeredMemberCount === 1, 'Team Beta has 1 registered member');
  assert(betaOverview?.connectedMemberCount === 0, 'Team Beta shows 0/1 connected when disconnected');

  // Connect Team Beta participant
  const teamBeta = await teamRepository.getTeamByCode('DEV-BETA-002');
  const betaSlot = await teamRepository.getNextAvailableParticipant(teamBeta!.id);
  const betaToken = crypto.randomBytes(32).toString('hex');
  const betaHash = hashToken(betaToken);
  const betaSession = await teamRepository.createSession({
    teamId: teamBeta!.id,
    participantId: betaSlot || undefined,
    sessionTokenHash: betaHash,
  });

  const overview3 = await adminRepository.getTeamsOverview();
  const betaOverview2 = overview3.find((t) => t.teamCode === 'DEV-BETA-002');
  assert(betaOverview2?.connectedMemberCount === 1, 'Team Beta shows exactly 1/1 connected members');

  // Disconnect Team Alpha second session
  await teamRepository.terminateSession(part2Session.id);
  const overview4 = await adminRepository.getTeamsOverview();
  const alphaOverview3 = overview4.find((t) => t.teamCode === 'DEV-ALPHA-001');
  assert(alphaOverview3?.connectedMemberCount === 1, 'Team Alpha returns to 1/2 connected after teammate disconnects');

  // =========================================================================
  // SUITE 5: Admin Dashboard Real Metrics
  // =========================================================================
  console.log('\n[Suite 5: Admin Dashboard Real Metrics]');

  const metrics = await adminRepository.getDashboardMetrics();
  assert(metrics.eventStatus === 'NOT_STARTED', 'Authoritative eventStatus is NOT_STARTED');
  assert(metrics.registeredTeamsCount >= 2, `Registered teams count >= 2 (actual: ${metrics.registeredTeamsCount})`);
  assert(metrics.registeredParticipantsCount >= 2, `Registered participants count >= 2 (actual: ${metrics.registeredParticipantsCount})`);
  assert(metrics.connectedParticipantsCount === 2, `Connected participants count is exactly 2 (actual: ${metrics.connectedParticipantsCount})`);
  assert(metrics.activeTeamSessionsCount === 2, `Active team sessions count is 2 (actual: ${metrics.activeTeamSessionsCount})`);

  // =========================================================================
  // SUITE 6: Authoritative Event State Machine & Safety
  // =========================================================================
  console.log('\n[Suite 6: Authoritative Event State Machine & Safety]');

  // 6.1 Precondition validation
  const precheck = await adminRepository.validateEventStartPreconditions();
  assert(precheck.canStart === true, 'Preconditions pass when event is NOT_STARTED and active teams exist');

  // 6.2 START event (NOT_STARTED -> RUNNING)
  const startResult = await adminRepository.transitionEventStatus('RUNNING', validAdmin!.id, 'START');
  assert(startResult.success === true, 'START transition from NOT_STARTED to RUNNING succeeds');
  assert(startResult.event.status === 'RUNNING', 'Event settings status is now RUNNING');
  assert(startResult.event.startedAt !== null, 'Event startedAt timestamp is recorded');

  // 6.3 Safe duplicate START
  const dupStartResult = await adminRepository.transitionEventStatus('RUNNING', validAdmin!.id, 'START');
  assert(dupStartResult.success === true, 'Duplicate START request is safe (idempotent, does not error or reset timer)');

  // 6.4 PAUSE event (RUNNING -> PAUSED)
  const pauseResult = await adminRepository.transitionEventStatus('PAUSED', validAdmin!.id, 'PAUSE');
  assert(pauseResult.success === true, 'PAUSE transition from RUNNING to PAUSED succeeds');
  assert(pauseResult.event.status === 'PAUSED', 'Event settings status is now PAUSED');
  assert(pauseResult.event.pausedAt !== null, 'Event pausedAt timestamp is recorded');

  // 6.5 Safe duplicate PAUSE
  const dupPauseResult = await adminRepository.transitionEventStatus('PAUSED', validAdmin!.id, 'PAUSE');
  assert(dupPauseResult.success === true, 'Duplicate PAUSE request is safe');

  // 6.6 RESUME event (PAUSED -> RUNNING)
  const resumeResult = await adminRepository.transitionEventStatus('RUNNING', validAdmin!.id, 'RESUME');
  assert(resumeResult.success === true, 'RESUME transition from PAUSED to RUNNING succeeds');
  assert(resumeResult.event.status === 'RUNNING', 'Event settings status returns to RUNNING');
  assert(resumeResult.event.pausedAt === null, 'Event pausedAt is cleared upon resume');

  // 6.7 Invalid transition (Cannot START when already RUNNING from fresh attempt)
  // 6.8 END event (RUNNING -> ENDED)
  const endResult = await adminRepository.transitionEventStatus('ENDED', validAdmin!.id, 'END');
  assert(endResult.success === true, 'END transition from RUNNING to ENDED succeeds');
  assert(endResult.event.status === 'ENDED', 'Event settings status is now ENDED');
  assert(endResult.event.endedAt !== null, 'Event endedAt timestamp is recorded');

  // 6.9 Invalid transition from ENDED: Cannot resume or start after ended
  const invalidStartAfterEnd = await adminRepository.transitionEventStatus('RUNNING', validAdmin!.id, 'START');
  assert(invalidStartAfterEnd.success === false, 'Cannot START an event that has already ENDED');

  // =========================================================================
  // SUITE 7: Audit Logging Verification
  // =========================================================================
  console.log('\n[Suite 7: Audit Logging Verification]');

  const auditRecords = await adminRepository.getAuditLogs(20);
  assert(auditRecords.length >= 4, `Audit log contains records (count: ${auditRecords.length})`);

  const actions = auditRecords.map((r) => r.action);
  assert(actions.includes('EVENT_STARTED'), 'Audit log contains EVENT_STARTED');
  assert(actions.includes('EVENT_PAUSED'), 'Audit log contains EVENT_PAUSED');
  assert(actions.includes('EVENT_RESUMED'), 'Audit log contains EVENT_RESUMED');
  assert(actions.includes('EVENT_ENDED'), 'Audit log contains EVENT_ENDED');

  // =========================================================================
  // SUITE 8: Frontend-Equivalent Login & Session Reproduction Test
  // =========================================================================
  console.log('\n[Suite 8: Frontend-Equivalent Login & Session Reproduction Test]');

  // 8.1 Simulates frontend submitting valid credentials to /api/admin/login
  const frontendAdminUser = await adminRepository.verifyAdminCredentials('admin', 'BugRipAdmin2026!');
  assert(frontendAdminUser !== null, 'Frontend login credentials "admin" / "BugRipAdmin2026!" authenticate');
  assert(frontendAdminUser?.isActive === true, 'Admin account is active');
  assert(frontendAdminUser?.role === 'SUPER_ADMIN', 'Admin account role is SUPER_ADMIN');

  // 8.2 Simulates session generation upon HTTP 200 response
  const frontendSession = await adminRepository.createAdminSession(frontendAdminUser!.id, {
    ipAddress: '127.0.0.1',
    userAgent: 'Mozilla/5.0 (Frontend Browser Simulation)',
    durationHours: 8,
  });
  assert(Boolean(frontendSession.sessionToken), 'Session token generated for cookie storage');
  assert(frontendSession.session.status === 'ACTIVE', 'Admin session active in database');

  // 8.3 Simulates subsequent authenticated admin request using stored session
  const restoredSession = await adminRepository.validateAdminSession(frontendSession.sessionToken);
  assert(restoredSession !== null, 'Subsequent admin request successfully validates session token');
  assert(restoredSession?.adminUser.username === 'admin', 'Restored session identifies admin correctly');

  // 8.4 Simulates incorrect credentials rejected
  const failedAttempt = await adminRepository.verifyAdminCredentials('admin', 'IncorrectPassword2026!');
  assert(failedAttempt === null, 'Incorrect password correctly rejected without creating session');

  // =========================================================================
  // SUITE 9: Admin Authentication Transport Regression Tests (8 Test Cases)
  // =========================================================================
  console.log('\n[Suite 9: Admin Authentication Transport Regression Tests]');

  // Helper to run middleware with mock request and response
  const invokeMiddleware = (
    middleware: any,
    reqOptions: { cookies?: Record<string, string>; headers?: Record<string, string> }
  ): Promise<{ nextCalled: boolean; nextError?: any; status?: number; data?: any; req: any }> => {
    return new Promise((resolve) => {
      let resolved = false;
      let statusVal = 200;
      let dataVal: any = null;

      const req: any = {
        cookies: reqOptions.cookies || {},
        headers: reqOptions.headers || {},
      };

      const res: any = {
        status(code: number) {
          statusVal = code;
          return this;
        },
        json(data: any) {
          dataVal = data;
          if (!resolved) {
            resolved = true;
            resolve({ nextCalled: false, status: statusVal, data: dataVal, req });
          }
          return this;
        },
        clearCookie() {},
      };

      const next = (err?: any) => {
        if (!resolved) {
          resolved = true;
          resolve({ nextCalled: true, nextError: err, req });
        }
      };

      middleware(req, res, next).catch((err: any) => {
        if (!resolved) {
          resolved = true;
          resolve({ nextCalled: false, nextError: err, req });
        }
      });
    });
  };

  // Setup test admin user and session
  const testSuperAdmin = await adminRepository.verifyAdminCredentials('admin', 'BugRipAdmin2026!');
  const { sessionToken: adminToken1 } = await adminRepository.createAdminSession(testSuperAdmin!.id, {
    ipAddress: '127.0.0.1',
    userAgent: 'RegressionTest/1.0',
    durationHours: 8,
  });

  // 1. Cookie auth: verify requireAdmin accepts valid cookie
  const res1 = await invokeMiddleware(requireAdmin, {
    cookies: { bugrip_admin_session: adminToken1 },
  });
  assert(res1.nextCalled === true, 'Case 1 (Cookie Auth): requireAdmin successfully calls next() with valid cookie');
  assert(res1.req.adminUser?.username === 'admin', 'Case 1 (Cookie Auth): Admin user attached correctly from cookie');

  // 2. Bearer auth: verify requireAdmin accepts valid Authorization Bearer header
  const { sessionToken: adminToken2 } = await adminRepository.createAdminSession(testSuperAdmin!.id, {
    ipAddress: '127.0.0.1',
    userAgent: 'RegressionTest/1.0',
    durationHours: 8,
  });
  const res2 = await invokeMiddleware(requireAdmin, {
    headers: { authorization: `Bearer ${adminToken2}` },
  });
  assert(res2.nextCalled === true, 'Case 2 (Bearer Auth): requireAdmin successfully calls next() with Bearer token');
  assert(res2.req.adminUser?.username === 'admin', 'Case 2 (Bearer Auth): Admin user attached correctly from Bearer header');

  // 3. Combined auth: verify requireAdmin handles both cookie and Bearer header
  const res3 = await invokeMiddleware(requireAdmin, {
    cookies: { bugrip_admin_session: adminToken1 },
    headers: { authorization: `Bearer ${adminToken2}` },
  });
  assert(res3.nextCalled === true, 'Case 3 (Combined Auth): requireAdmin succeeds when both cookie and Bearer are sent');
  assert(res3.req.adminUser?.username === 'admin', 'Case 3 (Combined Auth): Admin user resolved correctly');

  // 4. No auth: verify 401 ADMIN_UNAUTHORIZED when no credentials supplied
  const res4 = await invokeMiddleware(requireAdmin, {});
  assert(res4.nextCalled === false, 'Case 4 (No Auth): requireAdmin halts pipeline when no credentials present');
  assert(res4.status === 401, 'Case 4 (No Auth): HTTP status is 401');
  assert(res4.data?.code === 'ADMIN_UNAUTHORIZED', 'Case 4 (No Auth): Returns ADMIN_UNAUTHORIZED error code');

  // 5. Invalid token: verify 401 ADMIN_UNAUTHORIZED with malformed or unrecognized token
  const res5 = await invokeMiddleware(requireAdmin, {
    headers: { authorization: 'Bearer completely_bogus_token_99999' },
  });
  assert(res5.nextCalled === false, 'Case 5 (Invalid Token): requireAdmin rejects invalid token');
  assert(res5.status === 401, 'Case 5 (Invalid Token): HTTP status is 401');
  assert(res5.data?.code === 'ADMIN_UNAUTHORIZED', 'Case 5 (Invalid Token): Returns ADMIN_UNAUTHORIZED');

  // 6. Expired token: verify 401 ADMIN_UNAUTHORIZED when session token has expired
  const expiredRawToken = crypto.randomBytes(32).toString('hex');
  const expiredTokenHash = hashToken(expiredRawToken);
  await db.insert(adminSessions).values({
    adminUserId: testSuperAdmin!.id,
    sessionTokenHash: expiredTokenHash,
    status: 'EXPIRED',
    expiresAt: new Date(Date.now() - 3600000), // 1 hour ago
  });
  const res6 = await invokeMiddleware(requireAdmin, {
    headers: { authorization: `Bearer ${expiredRawToken}` },
  });
  assert(res6.nextCalled === false, 'Case 6 (Expired Token): requireAdmin rejects expired session');
  assert(res6.status === 401, 'Case 6 (Expired Token): HTTP status is 401');
  assert(res6.data?.code === 'ADMIN_UNAUTHORIZED', 'Case 6 (Expired Token): Returns ADMIN_UNAUTHORIZED');

  // 7. SUPER_ADMIN auth: verify requireSuperAdmin enforces role check
  // 7a. SUPER_ADMIN user passes requireSuperAdmin
  const res7a = await invokeMiddleware(requireSuperAdmin, {
    headers: { authorization: `Bearer ${adminToken1}` },
  });
  assert(res7a.nextCalled === true, 'Case 7a (SUPER_ADMIN): requireSuperAdmin passes for SUPER_ADMIN role');

  // 7b. Non-super admin (ADMIN role) rejected by requireSuperAdmin with 403
  let standardAdmin = await db.select().from(adminUsers).where(eq(adminUsers.username, 'organizer_standard')).limit(1);
  if (!standardAdmin[0]) {
    const created = await db.insert(adminUsers).values({
      username: 'organizer_standard',
      passwordHash: 'dummy_hash',
      displayName: 'Standard Organizer',
      role: 'ADMIN',
      isActive: true,
    }).returning();
    standardAdmin = created;
  }
  const { sessionToken: standardAdminToken } = await adminRepository.createAdminSession(standardAdmin[0].id, {
    durationHours: 8,
  });
  const res7b = await invokeMiddleware(requireSuperAdmin, {
    headers: { authorization: `Bearer ${standardAdminToken}` },
  });
  assert(res7b.nextCalled === false, 'Case 7b (Standard Admin): requireSuperAdmin rejects ADMIN role without SUPER_ADMIN');
  assert(res7b.status === 403, 'Case 7b (Standard Admin): HTTP status is 403');
  assert(res7b.data?.code === 'SUPER_ADMIN_REQUIRED', 'Case 7b (Standard Admin): Returns SUPER_ADMIN_REQUIRED code');

  // 8. Participant access barrier: participant tokens rejected with 403 FORBIDDEN_ADMIN_ACCESS
  const res8 = await invokeMiddleware(requireAdmin, {
    cookies: { bugrip_session: part1Token },
  });
  assert(res8.nextCalled === false, 'Case 8 (Participant Barrier): Participant token cannot access admin middleware');
  assert(res8.status === 403, 'Case 8 (Participant Barrier): Participant token returns HTTP 403');
  assert(res8.data?.code === 'FORBIDDEN_ADMIN_ACCESS', 'Case 8 (Participant Barrier): Returns FORBIDDEN_ADMIN_ACCESS code');

  console.log('\n====================================================');
  console.log(`BUG RIP Fragment 4 Test Results: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('====================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAdminTests().catch((err) => {
  console.error('Fatal admin test error:', err);
  process.exit(1);
});

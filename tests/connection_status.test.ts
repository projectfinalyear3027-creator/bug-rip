/**
 * BUG RIP - Authoritative Participant Connection Lifecycle & Immediate Admin Accuracy Tests
 * 
 * Verifies:
 * 1. Participant Join -> Immediately reflected as CONNECTED in Admin Dashboard & Team Overview.
 * 2. Participant Tab Close / Navigation (SSE socket close):
 *    -> Immediately decrements connected count (does not wait for 3-minute heartbeat expiration).
 *    -> Broadcasts 'admin.connection.changed' to active Admin SSE clients.
 * 3. Participant Disconnect Beacon (/api/auth/disconnect):
 *    -> Immediately unregisters active session and decrements connected count.
 * 4. Deduplication:
 *    -> Multiple tabs or reconnects for the same participant do NOT inflate count.
 * 5. Auth Session Preservation:
 *    -> SSE disconnect does NOT destroy participant auth session in database.
 *    -> Participant can reconnect seamlessly without logging in again.
 */

process.env.PG_MEM = 'true';

import { db } from '../src/db/index.ts';
import { runMigrations } from '../database/migrator.ts';
import { runSeed } from '../database/seed.ts';
import { seedTestTeams } from './helpers/testFixtures.ts';
import { teamRealtimeService, TeamClientConnection } from '../backend/services/teamRealtimeService.ts';
import { teamRepository } from '../backend/repositories/teamRepository.ts';
import { adminRepository } from '../backend/repositories/adminRepository.ts';
import { teams, sessions } from '../src/db/schema.ts';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

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

// Mock SSE response
class MockSseResponse {
  public writtenData: string[] = [];
  public closed = false;
  private closeListeners: Array<() => void> = [];

  write(chunk: string): boolean {
    if (this.closed) return false;
    this.writtenData.push(chunk);
    return true;
  }

  on(event: string, listener: () => void) {
    if (event === 'close') {
      this.closeListeners.push(listener);
    }
    return this;
  }

  emitClose() {
    this.closed = true;
    for (const l of this.closeListeners) l();
  }
}

async function runConnectionStatusTests() {
  console.log('================================================================');
  console.log('BUG RIP: Real-Time Connection Status & Immediate Departure Tests');
  console.log('================================================================');

  await runMigrations();
  await runSeed();
  await seedTestTeams();

  const [teamAlpha] = await db.select().from(teams).where(eq(teams.teamCode, 'DEV-ALPHA-001')).limit(1);
  assert(!!teamAlpha, 'Target Team Alpha found in database');

  // Initial state: 0 active connections
  const initialMetrics = await adminRepository.getDashboardMetrics();
  const initialConnected = initialMetrics.connectedParticipantsCount;
  console.log(`\n[Suite 1: Baseline Initial State] Connected participants: ${initialConnected}`);

  // Create participant session for Alpha Member 1
  const token1 = crypto.randomBytes(32).toString('hex');
  const tokenHash1 = crypto.createHash('sha256').update(token1).digest('hex');
  const session1 = await teamRepository.createSession({
    teamId: teamAlpha.id,
    sessionTokenHash: tokenHash1,
    userAgent: 'Alpha-Member-1-Browser',
  });
  assert(!!session1, 'Participant session created for Alpha Member 1');

  // Register Admin SSE listener
  const mockAdminRes = new MockSseResponse();
  teamRealtimeService.registerAdminClient(mockAdminRes as any);

  // 1. Participant opens tab -> Connects SSE
  console.log('\n[Suite 2: Participant Joins Tab]');
  const mockParticipantRes1 = new MockSseResponse();
  const clientConn1: TeamClientConnection = {
    id: 'conn-alpha-1',
    teamId: teamAlpha.id,
    sessionId: session1!.id,
    participantId: 'part-alpha-1',
    connectedAt: new Date(),
    lastHeartbeatAt: new Date(),
    res: mockParticipantRes1 as any,
  };

  await teamRealtimeService.registerClient(clientConn1);

  // Check metrics immediately
  const joinMetrics = await adminRepository.getDashboardMetrics();
  assert(
    joinMetrics.connectedParticipantsCount === initialConnected + 1,
    `Admin Dashboard metrics immediately reflect participant join (+1, total: ${joinMetrics.connectedParticipantsCount})`
  );

  const teamsOverview1 = await adminRepository.getTeamsOverview();
  const alphaOverview1 = teamsOverview1.find((t) => t.id === teamAlpha.id);
  assert(
    alphaOverview1?.connectedMembersCount === 1,
    `Admin Team Overview immediately shows 1 connected member (actual: ${alphaOverview1?.connectedMembersCount})`
  );

  // Verify Admin SSE received connection changed event
  const adminEventsAfterJoin = mockAdminRes.writtenData.filter((d) => d.includes('admin.connection.changed'));
  assert(adminEventsAfterJoin.length > 0, 'Admin SSE stream received real-time admin.connection.changed on join');

  // 2. Participant closes tab -> SSE emits 'close'
  console.log('\n[Suite 3: Participant Closes Tab (SSE Close Event)]');
  mockParticipantRes1.emitClose();

  // Allow microtasks to settle
  await new Promise((resolve) => setTimeout(resolve, 50));

  const leaveMetrics = await adminRepository.getDashboardMetrics();
  assert(
    leaveMetrics.connectedParticipantsCount === initialConnected,
    `Admin Dashboard metrics immediately reflect participant departure without delay (count returned to: ${leaveMetrics.connectedParticipantsCount})`
  );

  const teamsOverview2 = await adminRepository.getTeamsOverview();
  const alphaOverview2 = teamsOverview2.find((t) => t.id === teamAlpha.id);
  assert(
    alphaOverview2?.connectedMembersCount === 0,
    `Admin Team Overview immediately shows 0 connected members after tab close (actual: ${alphaOverview2?.connectedMembersCount})`
  );

  // 3. Auth Session Preservation
  console.log('\n[Suite 4: Authentication Session Remains Valid for Reconnection]');
  const sessionCheck = await db.select().from(sessions).where(eq(sessions.id, session1!.id)).limit(1);
  assert(
    sessionCheck[0]?.status === 'ACTIVE',
    'Participant session record in database remains ACTIVE (not destroyed on disconnect)'
  );

  // 4. Participant Reconnects (e.g. refreshes page or opens new tab)
  console.log('\n[Suite 5: Participant Reconnection & Deduplication]');
  const mockParticipantRes1Reconnected = new MockSseResponse();
  const clientConn1Reconnected: TeamClientConnection = {
    id: 'conn-alpha-1-reconnect',
    teamId: teamAlpha.id,
    sessionId: session1!.id,
    participantId: 'part-alpha-1',
    connectedAt: new Date(),
    lastHeartbeatAt: new Date(),
    res: mockParticipantRes1Reconnected as any,
  };

  await teamRealtimeService.registerClient(clientConn1Reconnected);

  const reconnectMetrics = await adminRepository.getDashboardMetrics();
  assert(
    reconnectMetrics.connectedParticipantsCount === initialConnected + 1,
    `Admin Dashboard metrics immediately increment on reconnect (+1, total: ${reconnectMetrics.connectedParticipantsCount})`
  );

  // If a second tab is opened for the SAME session/participant:
  const mockSecondTabRes = new MockSseResponse();
  const clientConnSecondTab: TeamClientConnection = {
    id: 'conn-alpha-1-tab2',
    teamId: teamAlpha.id,
    sessionId: session1!.id,
    participantId: 'part-alpha-1',
    connectedAt: new Date(),
    lastHeartbeatAt: new Date(),
    res: mockSecondTabRes as any,
  };

  await teamRealtimeService.registerClient(clientConnSecondTab);

  const dedupeMetrics = await adminRepository.getDashboardMetrics();
  assert(
    dedupeMetrics.connectedParticipantsCount === initialConnected + 1,
    `Multiple tabs for same participant are deduplicated (does not inflate count, total: ${dedupeMetrics.connectedParticipantsCount})`
  );

  // 5. Explicit Disconnect Beacon (/api/auth/disconnect)
  console.log('\n[Suite 6: Explicit Disconnect Beacon]');
  await teamRealtimeService.unregisterSession(session1!.id);

  const beaconMetrics = await adminRepository.getDashboardMetrics();
  assert(
    beaconMetrics.connectedParticipantsCount === initialConnected,
    `Admin Dashboard metrics immediately decrement when disconnect beacon unregisters session (count: ${beaconMetrics.connectedParticipantsCount})`
  );

  console.log('\n================================================================');
  console.log(`BUG RIP Connection Status Tests Complete: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('================================================================');

  if (testsFailed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runConnectionStatusTests().catch((err) => {
  console.error('Connection status test failed with uncaught exception:', err);
  process.exit(1);
});

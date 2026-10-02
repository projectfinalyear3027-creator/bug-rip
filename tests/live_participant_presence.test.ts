/**
 * BUG SNIPER - Live Participant Presence Automated Test Suite
 *
 * Verifies all 12 Presence Invariants:
 * 1. Authenticated participant heartbeat creates ONLINE presence
 * 2. Heartbeat refreshes lastSeenAt
 * 3. Participant becomes OFFLINE after >30 seconds without heartbeat
 * 4. Multiple participants maintain independent presence
 * 5. Presence is scoped to match ID / matchNumber
 * 6. Online participants appear before offline participants
 * 7. Existing score ordering remains unchanged inside each group
 * 8. Historical match leaderboard is unaffected
 * 9. Unauthenticated heartbeat is rejected
 * 10. Participant cannot update another participant's presence
 * 11. Live Score receives realtime presence updates
 * 12. No demo participants are created
 */

process.env.PG_MEM = 'true';
process.env.SEED_TEST_FIXTURES = 'true';

import crypto from 'crypto';
import { db } from '../src/db/index.ts';
import { runMigrations } from '../database/migrator.ts';
import { runSeed } from '../database/seed.ts';
import { presenceService } from '../backend/services/presenceService.ts';
import { eventService } from '../backend/services/eventService.ts';
import { adminRepository } from '../backend/repositories/adminRepository.ts';
import { leaderboardRealtimeService } from '../backend/services/leaderboardRealtimeService.ts';
import { presenceRouter } from '../backend/routes/presenceRoutes.ts';
import { authRouter } from '../backend/routes/authRoutes.ts';
import { leaderboardRouter } from '../backend/routes/leaderboardRoutes.ts';
import {
  participants,
  teams,
  sessions,
  challenges,
  teamChallenges,
  participantChallenges,
  competitionMatches,
  eventSettings,
} from '../src/db/schema.ts';
import { eq, sql } from 'drizzle-orm';

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

function createMockRes() {
  const res: any = {
    statusCode: 200,
    headers: {},
    data: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: any) {
      res.data = data;
      return res;
    },
    setHeader(k: string, v: string) {
      res.headers[k] = v;
      return res;
    },
    clearCookie() {
      return res;
    },
  };
  return res;
}

// Mock SSE spectator listener
class MockSseClient {
  public messages: Array<{ event?: string; data?: any }> = [];
  public closed = false;
  private closeListeners: Array<() => void> = [];

  write(chunk: string) {
    if (this.closed) return false;
    const lines = chunk.trim().split('\n');
    let currentEvent: string | undefined;
    let currentData: any;
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.substring(7).trim();
      } else if (line.startsWith('data: ')) {
        try {
          currentData = JSON.parse(line.substring(6).trim());
        } catch {
          currentData = line.substring(6).trim();
        }
      }
    }
    if (currentEvent || currentData !== undefined) {
      this.messages.push({ event: currentEvent, data: currentData });
    }
    return true;
  }

  on(event: string, fn: () => void) {
    if (event === 'close') this.closeListeners.push(fn);
  }

  emitClose() {
    this.closed = true;
    for (const fn of this.closeListeners) fn();
  }
}

async function runPresenceTestSuite() {
  console.log('\n========================================================================');
  console.log('BUG SNIPER: AUTHORITATIVE LIVE PARTICIPANT PRESENCE VERIFICATION');
  console.log('========================================================================\n');

  // Initialize DB & Seed
  await runMigrations();
  await runSeed({ includeDemoParticipants: false });
  presenceService.resetForTesting();

  // ---------------------------------------------------------------------------
  // 1. Authenticated Participant Heartbeat Creates ONLINE Presence
  // ---------------------------------------------------------------------------
  console.log('\n--- 1. Authenticated Heartbeat Creates ONLINE Presence ---');
  {
    // Create authenticated test participant & session
    const [p1] = await db
      .insert(participants)
      .values({
        name: 'Presence Test Participant 1',
        participantCode: 'PRES-001',
        college: 'MIT College of Engineering',
        status: 'ACTIVE',
      })
      .returning();

    const [s1] = await db
      .insert(sessions)
      .values({
        participantId: p1.id,
        sessionTokenHash: crypto.randomBytes(32).toString('hex'),
        status: 'ACTIVE',
      })
      .returning();

    const t0 = new Date('2026-10-02T10:00:00.000Z');
    const result = presenceService.recordHeartbeat({
      participantId: p1.id,
      sessionId: s1.id,
      matchNumber: 1,
      matchId: 'match-1-uuid',
      timestamp: t0,
    });

    assert(result.isOnline === true, 'Heartbeat record returned isOnline: true');
    assert(result.lastSeenAt.getTime() === t0.getTime(), 'Heartbeat recorded exact timestamp');

    const isOnlineNow = presenceService.isParticipantOnline(p1.id, 1, t0);
    assert(isOnlineNow === true, 'isParticipantOnline returns true for active participant');
  }

  // ---------------------------------------------------------------------------
  // 2. Heartbeat Refreshes lastSeenAt
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Heartbeat Refreshes lastSeenAt ---');
  {
    const [p2] = await db
      .insert(participants)
      .values({
        name: 'Presence Refresh Participant',
        participantCode: 'PRES-002',
        college: 'Stanford Tech',
        status: 'ACTIVE',
      })
      .returning();

    const [s2] = await db
      .insert(sessions)
      .values({
        participantId: p2.id,
        sessionTokenHash: crypto.randomBytes(32).toString('hex'),
        status: 'ACTIVE',
      })
      .returning();

    const tInitial = new Date('2026-10-02T10:00:00.000Z');
    presenceService.recordHeartbeat({
      participantId: p2.id,
      sessionId: s2.id,
      matchNumber: 1,
      timestamp: tInitial,
    });

    const recordedT1 = presenceService.getLastSeenAt(p2.id, 1);
    assert(recordedT1?.getTime() === tInitial.getTime(), 'Initial lastSeenAt timestamp confirmed');

    // Send second heartbeat 15 seconds later
    const tRefreshed = new Date('2026-10-02T10:00:15.000Z');
    presenceService.recordHeartbeat({
      participantId: p2.id,
      sessionId: s2.id,
      matchNumber: 1,
      timestamp: tRefreshed,
    });

    const recordedT2 = presenceService.getLastSeenAt(p2.id, 1);
    assert(recordedT2?.getTime() === tRefreshed.getTime(), 'Refreshed lastSeenAt timestamp confirmed');
    assert(recordedT2!.getTime() > recordedT1!.getTime(), 'lastSeenAt updated monotonically forward');
  }

  // ---------------------------------------------------------------------------
  // 3. Participant Becomes OFFLINE After >30 Seconds Without Heartbeat
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Participant Becomes OFFLINE After >30 Seconds ---');
  {
    const [p3] = await db
      .insert(participants)
      .values({
        name: 'Timeout Participant',
        participantCode: 'PRES-003',
        status: 'ACTIVE',
      })
      .returning();

    const [s3] = await db
      .insert(sessions)
      .values({
        participantId: p3.id,
        sessionTokenHash: crypto.randomBytes(32).toString('hex'),
        status: 'ACTIVE',
      })
      .returning();

    const tPulse = new Date('2026-10-02T10:00:00.000Z');
    presenceService.recordHeartbeat({
      participantId: p3.id,
      sessionId: s3.id,
      matchNumber: 1,
      timestamp: tPulse,
    });

    // At 20s elapsed: still ONLINE
    const t20s = new Date(tPulse.getTime() + 20000);
    assert(presenceService.isParticipantOnline(p3.id, 1, t20s) === true, 'Participant is ONLINE at 20s (< 30s threshold)');

    // At 30s elapsed: exactly at threshold = ONLINE
    const t30s = new Date(tPulse.getTime() + 30000);
    assert(presenceService.isParticipantOnline(p3.id, 1, t30s) === true, 'Participant is ONLINE at exactly 30s threshold');

    // At 31s elapsed: >30s without heartbeat = OFFLINE
    const t31s = new Date(tPulse.getTime() + 31000);
    assert(presenceService.isParticipantOnline(p3.id, 1, t31s) === false, 'Participant is OFFLINE at 31s (> 30s threshold)');

    // At 60s elapsed: clearly OFFLINE
    const t60s = new Date(tPulse.getTime() + 60000);
    assert(presenceService.isParticipantOnline(p3.id, 1, t60s) === false, 'Participant is OFFLINE at 60s');
  }

  // ---------------------------------------------------------------------------
  // 4. Multiple Participants Maintain Independent Presence
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Multiple Participants Maintain Independent Presence ---');
  {
    const [pA] = await db
      .insert(participants)
      .values({ name: 'Participant A', participantCode: 'PRES-4A', status: 'ACTIVE' })
      .returning();
    const [pB] = await db
      .insert(participants)
      .values({ name: 'Participant B', participantCode: 'PRES-4B', status: 'ACTIVE' })
      .returning();

    const now = new Date('2026-10-02T10:00:00.000Z');

    // Only Participant A sends heartbeat
    presenceService.recordHeartbeat({
      participantId: pA.id,
      sessionId: 'sess-4a',
      matchNumber: 1,
      timestamp: now,
    });

    assert(presenceService.isParticipantOnline(pA.id, 1, now) === true, 'Participant A is ONLINE');
    assert(presenceService.isParticipantOnline(pB.id, 1, now) === false, 'Participant B is OFFLINE');

    // Later: Participant B sends heartbeat at now + 25s
    const now25 = new Date(now.getTime() + 25000);
    presenceService.recordHeartbeat({
      participantId: pB.id,
      sessionId: 'sess-4b',
      matchNumber: 1,
      timestamp: now25,
    });

    // At now + 35s: Participant A is >35s stale (OFFLINE), Participant B is 10s stale (ONLINE)
    const now35 = new Date(now.getTime() + 35000);
    assert(presenceService.isParticipantOnline(pA.id, 1, now35) === false, 'Participant A timed out -> OFFLINE');
    assert(presenceService.isParticipantOnline(pB.id, 1, now35) === true, 'Participant B remains ONLINE independently');
  }

  // ---------------------------------------------------------------------------
  // 5. Presence Is Scoped to Match ID / matchNumber
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. Presence Is Scoped to Match ID / matchNumber ---');
  {
    const [pScope] = await db
      .insert(participants)
      .values({ name: 'Scoped Participant', participantCode: 'PRES-SCOPE', status: 'ACTIVE' })
      .returning();

    const now = new Date('2026-10-02T10:00:00.000Z');

    // Heartbeat recorded in Match 1
    presenceService.recordHeartbeat({
      participantId: pScope.id,
      sessionId: 'sess-scope',
      matchNumber: 1,
      matchId: 'match-1-uuid',
      timestamp: now,
    });

    assert(presenceService.isParticipantOnline(pScope.id, 1, now) === true, 'Participant is ONLINE for Match 1');
    assert(presenceService.isParticipantOnline(pScope.id, 2, now) === false, 'Participant is OFFLINE for Match 2 (no presence leakage)');

    // When admin starts Match 2
    presenceService.onMatchChange(2);
    assert(presenceService.isParticipantOnline(pScope.id, 2, now) === false, 'Match 2 initialized with empty presence');
  }

  // ---------------------------------------------------------------------------
  // 6. Online Participants Appear Before Offline Participants
  // ---------------------------------------------------------------------------
  console.log('\n--- 6. Online Participants Appear Before Offline Participants ---');
  {
    const mockNow = new Date('2026-10-02T10:00:00.000Z');
    const matchNumber = 10;
    presenceService.onMatchChange(matchNumber);

    const testEntries = [
      {
        rank: 1,
        teamName: 'Offline Leader',
        participantName: 'Offline Leader',
        participantId: 'id-offline-leader',
        problemsSolved: 4,
        score: 120,
        lastSolveTimestamp: '2026-10-02T10:00:00.000Z',
      },
      {
        rank: 2,
        teamName: 'Online RunnerUp',
        participantName: 'Online RunnerUp',
        participantId: 'id-online-runnerup',
        problemsSolved: 3,
        score: 90,
        lastSolveTimestamp: '2026-10-02T10:01:00.000Z',
      },
      {
        rank: 3,
        teamName: 'Online Third',
        participantName: 'Online Third',
        participantId: 'id-online-third',
        problemsSolved: 2,
        score: 70,
        lastSolveTimestamp: '2026-10-02T10:02:00.000Z',
      },
      {
        rank: 4,
        teamName: 'Offline Fourth',
        participantName: 'Offline Fourth',
        participantId: 'id-offline-fourth',
        problemsSolved: 1,
        score: 50,
        lastSolveTimestamp: '2026-10-02T10:03:00.000Z',
      },
    ];

    // Mark Online RunnerUp and Online Third as ONLINE
    presenceService.recordHeartbeat({
      participantId: 'id-online-runnerup',
      sessionId: 's-runner',
      matchNumber,
      timestamp: mockNow,
    });
    presenceService.recordHeartbeat({
      participantId: 'id-online-third',
      sessionId: 's-third',
      matchNumber,
      timestamp: mockNow,
    });

    const ordered = presenceService.applyLiveScoreboardOrdering(testEntries, matchNumber, false, mockNow);

    assert(ordered.length === 4, 'All 4 participants retained in output');
    assert(ordered[0].participantName === 'Online RunnerUp', '1st place in Live Score is Online RunnerUp (ONLINE)');
    assert(ordered[0].isOnline === true, '1st place has isOnline: true');
    assert(ordered[1].participantName === 'Online Third', '2nd place in Live Score is Online Third (ONLINE)');
    assert(ordered[1].isOnline === true, '2nd place has isOnline: true');
    assert(ordered[2].participantName === 'Offline Leader', '3rd place in Live Score is Offline Leader (OFFLINE)');
    assert(ordered[2].isOnline === false, '3rd place has isOnline: false');
    assert(ordered[3].participantName === 'Offline Fourth', '4th place in Live Score is Offline Fourth (OFFLINE)');
    assert(ordered[3].isOnline === false, '4th place has isOnline: false');

    // Verify canonical rank integrity: Offline Leader STILL has canonical rank 1!
    assert(ordered[2].rank === 1, 'Offline Leader retains canonical rank 1 (rank calculation is NOT corrupted)');
    assert(ordered[0].rank === 2, 'Online RunnerUp retains canonical rank 2');
  }

  // ---------------------------------------------------------------------------
  // 7. Existing Score Ordering Remains Unchanged Inside Each Group
  // ---------------------------------------------------------------------------
  console.log('\n--- 7. Existing Score Ordering Remains Unchanged Inside Each Group ---');
  {
    const mockNow = new Date('2026-10-02T10:00:00.000Z');
    const matchNumber = 11;
    presenceService.onMatchChange(matchNumber);

    const testEntries = [
      // 3 ONLINE participants with different scores
      {
        rank: 1,
        teamName: 'Online A (2 Solves, 60pts)',
        participantId: 'id-on-a',
        problemsSolved: 2,
        score: 60,
        lastSolveTimestamp: '2026-10-02T10:05:00.000Z',
      },
      {
        rank: 2,
        teamName: 'Online B (3 Solves, 90pts)',
        participantId: 'id-on-b',
        problemsSolved: 3,
        score: 90,
        lastSolveTimestamp: '2026-10-02T10:04:00.000Z',
      },
      {
        rank: 3,
        teamName: 'Online C (2 Solves, 80pts)',
        participantId: 'id-on-c',
        problemsSolved: 2,
        score: 80,
        lastSolveTimestamp: '2026-10-02T10:03:00.000Z',
      },
      // 2 OFFLINE participants
      {
        rank: 4,
        teamName: 'Offline D (1 Solve, 10pts)',
        participantId: 'id-off-d',
        problemsSolved: 1,
        score: 10,
        lastSolveTimestamp: '2026-10-02T10:06:00.000Z',
      },
      {
        rank: 5,
        teamName: 'Offline E (1 Solve, 40pts)',
        participantId: 'id-off-e',
        problemsSolved: 1,
        score: 40,
        lastSolveTimestamp: '2026-10-02T10:02:00.000Z',
      },
    ];

    presenceService.recordHeartbeat({ participantId: 'id-on-a', sessionId: 's-a', matchNumber, timestamp: mockNow });
    presenceService.recordHeartbeat({ participantId: 'id-on-b', sessionId: 's-b', matchNumber, timestamp: mockNow });
    presenceService.recordHeartbeat({ participantId: 'id-on-c', sessionId: 's-c', matchNumber, timestamp: mockNow });

    const ordered = presenceService.applyLiveScoreboardOrdering(testEntries, matchNumber, false, mockNow);

    // Online group ordering:
    // Online B: 3 solves (highest solves wins)
    // Online C: 2 solves, 80 pts (higher score wins)
    // Online A: 2 solves, 60 pts
    assert(ordered[0].participantId === 'id-on-b', 'Online group #1 is Online B (3 solves)');
    assert(ordered[1].participantId === 'id-on-c', 'Online group #2 is Online C (2 solves, 80 pts)');
    assert(ordered[2].participantId === 'id-on-a', 'Online group #3 is Online A (2 solves, 60 pts)');

    // Offline group ordering:
    // Offline E: 1 solve, 40 pts
    // Offline D: 1 solve, 10 pts
    assert(ordered[3].participantId === 'id-off-e', 'Offline group #1 is Offline E (40 pts)');
    assert(ordered[4].participantId === 'id-off-d', 'Offline group #2 is Offline D (10 pts)');
  }

  // ---------------------------------------------------------------------------
  // 8. Historical Match Leaderboard Is Unaffected
  // ---------------------------------------------------------------------------
  console.log('\n--- 8. Historical Match Leaderboard Is Unaffected ---');
  {
    const historicalEntries = [
      {
        rank: 1,
        teamName: 'Champion (Offline)',
        participantId: 'id-champ',
        problemsSolved: 5,
        score: 200,
        lastSolveTimestamp: '2026-10-02T09:00:00.000Z',
        isOnline: false,
      },
      {
        rank: 2,
        teamName: 'Runner Up (Online)',
        participantId: 'id-runner',
        problemsSolved: 3,
        score: 100,
        lastSolveTimestamp: '2026-10-02T09:05:00.000Z',
        isOnline: true,
      },
    ];

    // isArchivedMatch = true: ordering MUST remain unchanged
    const preserved = presenceService.applyLiveScoreboardOrdering(historicalEntries, 1, true);
    assert(preserved[0].participantId === 'id-champ', 'Historical match retains Rank 1 Champion first');
    assert(preserved[1].participantId === 'id-runner', 'Historical match retains Rank 2 Runner Up second');
  }

  // ---------------------------------------------------------------------------
  // 9. Unauthenticated Heartbeat Is Rejected
  // ---------------------------------------------------------------------------
  console.log('\n--- 9. Unauthenticated Heartbeat Is Rejected ---');
  {
    const reqUnauth: any = {
      headers: {},
      cookies: {},
      body: {},
    };
    const resUnauth = createMockRes();

    // Call presenceRouter POST /heartbeat without auth
    let nextCalled = false;
    let nextError: any = null;
    await new Promise<void>((resolve) => {
      // Find the handler or invoke middleware
      const routes = (presenceRouter as any).stack;
      const hbLayer = routes.find((layer: any) => layer.route?.path === '/heartbeat');
      if (hbLayer && hbLayer.route) {
        const [authMw, handler] = hbLayer.route.stack;
        authMw.handle(reqUnauth, resUnauth, (err: any) => {
          nextCalled = true;
          nextError = err;
          resolve();
        });
        // If auth rejects with res.status(401), resolve
        setTimeout(resolve, 50);
      } else {
        resolve();
      }
    });

    assert(
      resUnauth.statusCode === 401,
      `Unauthenticated heartbeat returns HTTP 401 (got ${resUnauth.statusCode})`
    );
    assert(resUnauth.data?.code === 'UNAUTHENTICATED', 'Rejected with code: UNAUTHENTICATED');
  }

  // ---------------------------------------------------------------------------
  // 10. Participant Cannot Update Another Participant's Presence
  // ---------------------------------------------------------------------------
  console.log('\n--- 10. Participant Cannot Update Another Participant\'s Presence ---');
  {
    const [victim] = await db
      .insert(participants)
      .values({ name: 'Victim Participant', participantCode: 'PRES-VICTIM', status: 'ACTIVE' })
      .returning();

    const [attacker] = await db
      .insert(participants)
      .values({ name: 'Attacker Participant', participantCode: 'PRES-ATTACKER', status: 'ACTIVE' })
      .returning();

    const [attackerSess] = await db
      .insert(sessions)
      .values({
        participantId: attacker.id,
        sessionTokenHash: 'attacker-token-' + Date.now(),
        status: 'ACTIVE',
      })
      .returning();

    // Attacker tries to send heartbeat spoofing victim's participantId
    const reqSpoof: any = {
      participant: { id: attacker.id, name: attacker.name },
      team: { id: attacker.id, teamName: attacker.name, registeredMemberCount: 1 },
      sessionRecord: { id: attackerSess.id, participantId: attacker.id },
      body: { participantId: victim.id }, // Attempt to mark victim as online
    };
    const resSpoof = createMockRes();

    const routes = (presenceRouter as any).stack;
    const hbLayer = routes.find((layer: any) => layer.route?.path === '/heartbeat');
    const handler = hbLayer.route.stack[hbLayer.route.stack.length - 1].handle;

    await handler(reqSpoof, resSpoof, () => {});

    assert(resSpoof.statusCode === 403, `Spoof attempt rejected with HTTP 403 Forbidden (got ${resSpoof.statusCode})`);
    assert(resSpoof.data?.code === 'PRESENCE_SPOOF_REJECTED', 'Response code is PRESENCE_SPOOF_REJECTED');

    // Verify victim remains OFFLINE
    assert(
      presenceService.isParticipantOnline(victim.id, 1) === false,
      'Victim remains strictly OFFLINE despite spoofing attempt'
    );
  }

  // ---------------------------------------------------------------------------
  // 11. Live Score Receives Realtime Presence Updates
  // ---------------------------------------------------------------------------
  console.log('\n--- 11. Live Score Receives Realtime Presence Updates ---');
  {
    const mockSseClient = new MockSseClient();
    leaderboardRealtimeService.registerClient(mockSseClient as any);

    const [pLive] = await db
      .insert(participants)
      .values({ name: 'Live Event Participant', participantCode: 'PRES-LIVE', status: 'ACTIVE' })
      .returning();

    // Record heartbeat transition: OFFLINE -> ONLINE
    presenceService.recordHeartbeat({
      participantId: pLive.id,
      sessionId: 'sess-live',
      matchNumber: 1,
    });

    const presenceEvent = mockSseClient.messages.find((m) => m.event === 'presence.updated');
    assert(Boolean(presenceEvent), 'Spectator received presence.updated realtime SSE event');
    assert(
      presenceEvent?.data?.presenceMap?.[pLive.id] === true,
      'SSE event payload confirms participant is ONLINE'
    );
    assert(
      typeof presenceEvent?.data?.onlineCount === 'number',
      `SSE event includes onlineCount (${presenceEvent?.data?.onlineCount})`
    );

    mockSseClient.emitClose();
  }

  // ---------------------------------------------------------------------------
  // 12. No Demo Participants Are Created
  // ---------------------------------------------------------------------------
  console.log('\n--- 12. No Demo Participants Are Created ---');
  {
    const allParticipants = await db.select().from(participants);
    const hasDemo = allParticipants.some((p) => {
      const lowerName = (p.name || '').toLowerCase();
      const lowerCode = (p.participantCode || '').toLowerCase();
      return (
        lowerName.includes('demo') ||
        lowerCode.includes('demo') ||
        lowerName.includes('fake') ||
        lowerName.includes('mock')
      );
    });

    assert(!hasDemo, 'Database contains 0 demo/mock/fake participants');
    console.log(`  ✓ Verified total real participants in DB: ${allParticipants.length}`);
  }

  console.log('\n========================================================================');
  console.log(`TEST SUMMARY: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('========================================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runPresenceTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

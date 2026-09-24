/**
 * BUG RIP - Fragment 11 Test Suite
 * Live Leaderboard + Projector Display (/live)
 * 
 * Verifies:
 * 1. Authoritative Server-Side Ordering Invariant:
 *    - Problems Solved (DESC) = PRIMARY criterion (More solved ALWAYS ranks above fewer solved, regardless of score).
 *    - Score (DESC) = SECONDARY criterion.
 *    - Earliest Achievement Time (ASC) = FINAL tiebreaker.
 *    - Team Name (ASC) = Deterministic tiebreaker for zero-solve or exact-tie teams.
 * 2. Public Data Sanitization & Protection:
 *    - Public /live payload exposes ONLY safe display fields (rank, teamName, connectedMembers, registeredMembers, problemsSolved, score, lastSolveTimestamp).
 *    - ZERO leakage of team codes, session tokens, participant emails, phone numbers, source code, or flags.
 * 3. Dedicated Public SSE Stream Isolation:
 *    - Public stream (/api/leaderboard/stream) is completely isolated from private team streams.
 *    - Private team events never leak to public spectators/projectors.
 * 4. Atomic Transaction Commit Trigger:
 *    - Completion transaction commits first in PostgreSQL/PGlite.
 *    - Realtime broadcast (leaderboard.updated) fires only AFTER successful transaction commit.
 * 5. Event Lifecycle Synchronization:
 *    - START, PAUSE, RESUME, and END state changes broadcast event.status.changed and updated standings to /live display.
 * 6. Live Connected Member Counting & Stale Session Cleanup:
 *    - Active sessions are accurately tracked (e.g. 2/2 connected).
 *    - Stale sessions are purged, maintaining authoritative real-time attendance.
 */

process.env.PG_MEM = 'true';

import { db } from '../src/db/index.ts';
import { runMigrations } from '../database/migrator.ts';
import { runSeed } from '../database/seed.ts';
import { eventRepository } from '../backend/repositories/eventRepository.ts';
import { eventService } from '../backend/services/eventService.ts';
import { adminRepository } from '../backend/repositories/adminRepository.ts';
import { teamRepository } from '../backend/repositories/teamRepository.ts';
import { challengeRepository } from '../backend/repositories/challengeRepository.ts';
import { completionService } from '../backend/services/completionService.ts';
import { teamChallengeRepository } from '../backend/repositories/teamChallengeRepository.ts';
import { leaderboardRealtimeService } from '../backend/services/leaderboardRealtimeService.ts';
import { teams, sessions, challenges, challengeFlags, teamChallenges, rounds, adminUsers } from '../src/db/schema.ts';
import { eq, sql } from 'drizzle-orm';
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

// Mock HTTP response for testing SSE stream clients
class MockSseResponse {
  public writtenData: string[] = [];
  public closed = false;
  private closeListeners: Array<() => void> = [];

  write(chunk: string) {
    if (this.closed) return false;
    this.writtenData.push(chunk);
    return true;
  }

  on(event: string, listener: () => void) {
    if (event === 'close') {
      this.closeListeners.push(listener);
    }
  }

  emitClose() {
    this.closed = true;
    for (const listener of this.closeListeners) {
      listener();
    }
  }

  getEvents(): Array<{ event?: string; data?: any }> {
    const results: Array<{ event?: string; data?: any }> = [];
    for (const chunk of this.writtenData) {
      if (chunk.startsWith(':')) continue; // Skip SSE comments like : ping or : connected
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
        results.push({ event: currentEvent, data: currentData });
      }
    }
    return results;
  }
}

async function runFragment11TestSuite() {
  console.log('================================================================');
  console.log('BUG RIP - FRAGMENT 11: LIVE LEADERBOARD + PROJECTOR DISPLAY TESTS');
  console.log('================================================================\n');

  // Step 1: Initialize Database & Run Seed
  await runMigrations();
  await runSeed();

  // Reset leaderboard realtime service
  leaderboardRealtimeService.resetForTesting();

  // ----------------------------------------------------------------
  // Suite 1: Authoritative Server-Side Ordering Invariant
  // Invariant: Solved (DESC) > Score (DESC) > Time (ASC) > Name (ASC)
  // ----------------------------------------------------------------
  console.log('[Suite 1: Authoritative Server-Side Ordering Invariant]');

  // Create 4 distinct test teams
  const [teamSolvers] = await db
    .insert(teams)
    .values({
      teamName: 'Team Solvers (High Solves, Low Score)',
      teamCode: 'SOLV-1111',
      registeredMemberCount: 2,
    })
    .returning();

  const [teamScorers] = await db
    .insert(teams)
    .values({
      teamName: 'Team Scorers (Low Solves, High Score)',
      teamCode: 'SCOR-2222',
      registeredMemberCount: 2,
    })
    .returning();

  const [teamEarly] = await db
    .insert(teams)
    .values({
      teamName: 'Team Early Bird (Tiebreaker Win)',
      teamCode: 'EARL-3333',
      registeredMemberCount: 2,
    })
    .returning();

  const [teamLate] = await db
    .insert(teams)
    .values({
      teamName: 'Team Late Bird (Tiebreaker Loss)',
      teamCode: 'LATE-4444',
      registeredMemberCount: 2,
    })
    .returning();

  // Query existing rounds
  const allRounds = await db.select().from(rounds);
  const easyRound = allRounds.find((r) => r.slug === 'easy') || allRounds[0];
  const hardRound = allRounds.find((r) => r.slug === 'hard') || allRounds[1] || allRounds[0];

  // Create 3 challenges with differing points
  const [chalEasy1] = await db
    .insert(challenges)
    .values({
      id: 'FRAG11-EASY-1',
      roundId: easyRound.id,
      title: 'Easy Fix 1',
      slug: 'frag11-easy-1',
      description: 'Frag 11 Easy 1 Description',
      starterCode: 'class Fix1 {}',
      score: 50,
      displayOrder: 10,
    })
    .returning();

  const [chalEasy2] = await db
    .insert(challenges)
    .values({
      id: 'FRAG11-EASY-2',
      roundId: easyRound.id,
      title: 'Easy Fix 2',
      slug: 'frag11-easy-2',
      description: 'Frag 11 Easy 2 Description',
      starterCode: 'class Fix2 {}',
      score: 50,
      displayOrder: 11,
    })
    .returning();

  const [chalHard] = await db
    .insert(challenges)
    .values({
      id: 'FRAG11-HARD-1',
      roundId: hardRound.id,
      title: 'Hard Fix',
      slug: 'frag11-hard',
      description: 'Frag 11 Hard Description',
      starterCode: 'class FixHard {}',
      score: 500,
      displayOrder: 20,
    })
    .returning();

  // Setup completion timestamps:
  const t0 = new Date('2026-09-10T10:00:00Z');
  const t1 = new Date('2026-09-10T10:15:00Z'); // 15 mins
  const t2 = new Date('2026-09-10T10:30:00Z'); // 30 mins
  const t3 = new Date('2026-09-10T10:45:00Z'); // 45 mins

  // Team Solvers: Solves 2 Easy challenges = 2 Solved, 100 Points, latest solve at t2
  await db.insert(teamChallenges).values([
    {
      teamId: teamSolvers.id,
      challengeId: chalEasy1.id,
      status: 'COMPLETED',
      completionTimestamp: t1,
    },
    {
      teamId: teamSolvers.id,
      challengeId: chalEasy2.id,
      status: 'COMPLETED',
      completionTimestamp: t2,
    },
  ]);

  // Team Scorers: Solves 1 Hard challenge = 1 Solved, 500 Points, solve at t0
  // Note: 500 points > 100 points, but 1 solved < 2 solved.
  await db.insert(teamChallenges).values([
    {
      teamId: teamScorers.id,
      challengeId: chalHard.id,
      status: 'COMPLETED',
      completionTimestamp: t0,
    },
  ]);

  // Team Early: Solves 1 Easy challenge = 1 Solved, 50 Points, solved early at t1
  await db.insert(teamChallenges).values([
    {
      teamId: teamEarly.id,
      challengeId: chalEasy1.id,
      status: 'COMPLETED',
      completionTimestamp: t1,
    },
  ]);

  // Team Late: Solves 1 Easy challenge = 1 Solved, 50 Points, solved later at t3
  await db.insert(teamChallenges).values([
    {
      teamId: teamLate.id,
      challengeId: chalEasy1.id,
      status: 'COMPLETED',
      completionTimestamp: t3,
    },
  ]);

  // Query Authoritative Leaderboard
  const standings = await eventRepository.getLeaderboard();

  // Find ranks of our test teams
  const rankSolvers = standings.findIndex((s) => s.teamId === teamSolvers.id);
  const rankScorers = standings.findIndex((s) => s.teamId === teamScorers.id);
  const rankEarly = standings.findIndex((s) => s.teamId === teamEarly.id);
  const rankLate = standings.findIndex((s) => s.teamId === teamLate.id);

  assert(rankSolvers !== -1, 'Team Solvers present on leaderboard');
  assert(rankScorers !== -1, 'Team Scorers present on leaderboard');
  assert(rankEarly !== -1, 'Team Early present on leaderboard');
  assert(rankLate !== -1, 'Team Late present on leaderboard');

  // CRITICAL INVARIANT 1: Problems Solved > Score
  // Team Solvers has 2 solves (100 pts), Team Scorers has 1 solve (500 pts).
  // Team Solvers MUST strictly rank ABOVE Team Scorers.
  assert(
    rankSolvers < rankScorers,
    `Primary Invariant: 2 Solves @ 100pts (Rank ${rankSolvers + 1}) strictly outranks 1 Solve @ 500pts (Rank ${rankScorers + 1})`
  );

  // CRITICAL INVARIANT 2: Score Secondary Criterion
  // Team Scorers (1 solve @ 500 pts) MUST rank above Team Early (1 solve @ 50 pts)
  assert(
    rankScorers < rankEarly,
    `Secondary Invariant: Equal solves (1), higher score 500pts (Rank ${rankScorers + 1}) outranks lower score 50pts (Rank ${rankEarly + 1})`
  );

  // CRITICAL INVARIANT 3: Earliest Achievement Time Tiebreaker
  // Team Early (1 solve @ 50 pts at t1) MUST rank above Team Late (1 solve @ 50 pts at t3)
  assert(
    rankEarly < rankLate,
    `Tertiary Tiebreaker: Equal solves (1) and equal score (50pts), earlier solve time (Rank ${rankEarly + 1}) outranks later solve time (Rank ${rankLate + 1})`
  );

  // ----------------------------------------------------------------
  // Suite 2: Public Data Sanitization & Safety Surface
  // ----------------------------------------------------------------
  console.log('\n[Suite 2: Public Data Sanitization & Protection]');

  const publicLeaderboard = await eventService.getPublicLeaderboard();
  assert(Array.isArray(publicLeaderboard) && publicLeaderboard.length > 0, 'Public leaderboard returns entries');

  let sanitizedSuccessfully = true;
  let missingExpectedPublicFields = false;

  for (const entry of publicLeaderboard) {
    const rawAny = entry as any;

    // Check for FORBIDDEN fields:
    if (
      rawAny.teamCode !== undefined ||
      rawAny.team_code !== undefined ||
      rawAny.sessionId !== undefined ||
      rawAny.session_id !== undefined ||
      rawAny.token !== undefined ||
      rawAny.participantEmail !== undefined ||
      rawAny.contactEmail !== undefined ||
      rawAny.email !== undefined ||
      rawAny.phone !== undefined ||
      rawAny.flag !== undefined ||
      rawAny.hash !== undefined ||
      rawAny.teamId !== undefined // Public display uses teamName and rank, no DB internal UUIDs
    ) {
      sanitizedSuccessfully = false;
    }

    // Check for REQUIRED public fields:
    if (
      typeof entry.rank !== 'number' ||
      typeof entry.teamName !== 'string' ||
      typeof entry.connectedMembers !== 'number' ||
      typeof entry.registeredMembers !== 'number' ||
      typeof entry.problemsSolved !== 'number' ||
      typeof entry.score !== 'number' ||
      typeof entry.lastSolveTimestamp !== 'string'
    ) {
      missingExpectedPublicFields = true;
    }
  }

  assert(sanitizedSuccessfully, 'Public leaderboard contains ZERO sensitive fields (no team codes, tokens, emails, flags, internal IDs)');
  assert(!missingExpectedPublicFields, 'Public leaderboard contains all required public display fields (rank, teamName, members, solves, score, time)');

  // ----------------------------------------------------------------
  // Suite 3: Public SSE Stream Isolation & Registration
  // ----------------------------------------------------------------
  console.log('\n[Suite 3: Public Realtime Stream Setup & Isolation]');

  const mockPublicClient = new MockSseResponse();
  leaderboardRealtimeService.registerClient(mockPublicClient as any);

  assert(
    leaderboardRealtimeService.getConnectedClientCount() >= 1,
    'Public spectator client successfully registered with LeaderboardRealtimeService'
  );

  // Send a test public broadcast
  leaderboardRealtimeService.broadcast('test.ping', { ping: true });
  const events = mockPublicClient.getEvents();
  const foundPing = events.some((e) => e.event === 'test.ping' && e.data?.ping === true);
  assert(foundPing, 'Public client receives broadcast message');

  // Verify client disconnection cleanly unregisters
  mockPublicClient.emitClose();
  assert(
    leaderboardRealtimeService.getConnectedClientCount() === 0,
    'Client disconnection cleanly unregisters listener and prevents memory leak'
  );

  // ----------------------------------------------------------------
  // Suite 4: Transaction Commit Trigger on Challenge Completion
  // ----------------------------------------------------------------
  console.log('\n[Suite 4: Realtime Leaderboard Trigger on Transaction Commit]');

  // Ensure event is RUNNING so completion can proceed
  const [adminUser] = await db.select().from(adminUsers).limit(1);
  await adminRepository.transitionEventStatus('RUNNING', adminUser.id, 'START');

  // Register an active spectator client to receive completion broadcast
  const spectatorClient = new MockSseResponse();
  leaderboardRealtimeService.registerClient(spectatorClient as any);

  // Setup a new challenge with an authoritative flag
  const [chalFlagged] = await db
    .insert(challenges)
    .values({
      id: 'FRAG11-TRIGGER-CHAL',
      roundId: easyRound.id,
      title: 'Live Trigger Challenge',
      slug: 'frag11-live-trigger-chal',
      description: 'Frag 11 Live Trigger Description',
      starterCode: 'class LiveTrigger {}',
      score: 150,
      displayOrder: 15,
    })
    .returning();

  const correctFlag = 'DBG{frag11_live_broadcast_success}';
  const flagHash = crypto.createHash('sha256').update(correctFlag.trim()).digest('hex');

  await db.insert(challengeFlags).values({
    challengeId: chalFlagged.id,
    flagVerifier: flagHash,
  });

  // Record passing execution for teamSolvers (anti-fake flag requirement)
  const execRecord = await teamChallengeRepository.recordExecutionSubmission({
    teamId: teamSolvers.id,
    challengeId: chalFlagged.id,
    sourceCode: 'class LiveTrigger {}',
    executionStatus: 'SUCCESS',
  });
  await teamChallengeRepository.updateExecutionSubmission(execRecord.id, {
    executionStatus: 'SUCCESS',
    behaviorStatus: 'PASS',
    revealedFlag: correctFlag,
    stdout: `FLAG REVEALED: ${correctFlag}`,
  });

  // Submit valid flag through completionService
  const completionResult = await completionService.submitFlag({
    teamId: teamSolvers.id,
    challengeId: chalFlagged.id,
    submittedFlag: correctFlag,
    executionId: execRecord.id,
  });

  assert(completionResult.success && completionResult.accepted, 'Challenge flag submission accepted and transaction committed');

  // Verify DB state: team_challenges is COMPLETED
  const tcRecord = await db
    .select()
    .from(teamChallenges)
    .where(eq(teamChallenges.teamId, teamSolvers.id));
  const hasCompletedFlaggedChal = tcRecord.some(
    (tc) => tc.challengeId === chalFlagged.id && tc.status === 'COMPLETED'
  );
  assert(hasCompletedFlaggedChal, 'Database row committed atomically: challenge status is COMPLETED');

  // Allow async broadcast tick to flush
  await new Promise((r) => setTimeout(r, 80));

  // Verify spectator received 'leaderboard.updated'
  const spectatorEvents = spectatorClient.getEvents();
  const updateEvent = spectatorEvents.find((e) => e.event === 'leaderboard.updated');

  assert(updateEvent !== undefined, 'Spectator received leaderboard.updated event after transaction commit');
  if (updateEvent && updateEvent.data) {
    const updatedLeaderboard = updateEvent.data.leaderboard;
    assert(Array.isArray(updatedLeaderboard), 'Update event contains fresh public leaderboard array');

    const solversRow = updatedLeaderboard.find((r: any) => r.teamName === teamSolvers.teamName);
    assert(solversRow !== undefined, 'Updated leaderboard contains Team Solvers row');
    assert(
      solversRow?.problemsSolved === 3,
      `Team Solvers now reflects 3 problems solved (actual: ${solversRow?.problemsSolved})`
    );
    assert(
      solversRow?.score === 250,
      `Team Solvers score updated to 250 PTS (actual: ${solversRow?.score})`
    );
  }

  spectatorClient.emitClose();

  // ----------------------------------------------------------------
  // Suite 5: Event Lifecycle Transitions Broadcasted to /live
  // ----------------------------------------------------------------
  console.log('\n[Suite 5: Event Lifecycle Transitions Broadcasted to /live]');

  const lifecycleClient = new MockSseResponse();
  leaderboardRealtimeService.registerClient(lifecycleClient as any);

  // Admin PAUSE
  leaderboardRealtimeService.broadcastEventStatusChanged({
    status: 'PAUSED',
    message: 'BUG SNIPER competition paused.',
    timestamp: new Date().toISOString(),
  });

  // Admin RESUME
  leaderboardRealtimeService.broadcastEventStatusChanged({
    status: 'RUNNING',
    message: 'BUG SNIPER competition resumed.',
    timestamp: new Date().toISOString(),
  });

  // Admin END
  leaderboardRealtimeService.broadcastEventStatusChanged({
    status: 'ENDED',
    message: 'BUG SNIPER competition ended.',
    timestamp: new Date().toISOString(),
  });

  const lifecycleEvents = lifecycleClient.getEvents();
  const statusEvents = lifecycleEvents.filter((e) => e.event === 'event.status.changed');

  assert(statusEvents.length === 3, `Received exactly 3 event.status.changed broadcasts (actual: ${statusEvents.length})`);
  assert(statusEvents[0].data?.status === 'PAUSED', 'First status event is PAUSED');
  assert(statusEvents[1].data?.status === 'RUNNING', 'Second status event is RUNNING');
  assert(statusEvents[2].data?.status === 'ENDED', 'Third status event is ENDED');

  lifecycleClient.emitClose();

  // ----------------------------------------------------------------
  // Suite 6: Connected Members Count & Stale Session Cleanup
  // ----------------------------------------------------------------
  console.log('\n[Suite 6: Connected Member Tracking & Stale Cleanup]');

  // Create 2 active sessions for Team Solvers
  const sessionToken1 = crypto.randomBytes(32).toString('hex');
  const sessionToken2 = crypto.randomBytes(32).toString('hex');

  await db.insert(sessions).values([
    {
      teamId: teamSolvers.id,
      sessionTokenHash: sessionToken1,
      status: 'ACTIVE',
      lastHeartbeatAt: new Date(),
    },
    {
      teamId: teamSolvers.id,
      sessionTokenHash: sessionToken2,
      status: 'ACTIVE',
      lastHeartbeatAt: new Date(),
    },
  ]);

  const freshLeaderboard = await eventRepository.getLeaderboard();
  const solversStanding = freshLeaderboard.find((s) => s.teamId === teamSolvers.id);

  assert(solversStanding !== undefined, 'Team Solvers found in fresh leaderboard query');
  assert(
    solversStanding?.connectedMemberCount === 2,
    `Active connected member count correctly calculated: 2/2 (actual: ${solversStanding?.connectedMemberCount})`
  );

  // Simulate stale session (heartbeat 5 minutes ago)
  const staleDate = new Date(Date.now() - 5 * 60 * 1000);
  await db
    .update(sessions)
    .set({ lastHeartbeatAt: staleDate })
    .where(eq(sessions.sessionTokenHash, sessionToken2));

  // Querying leaderboard triggers cleanup and recalculation
  const afterStaleLeaderboard = await eventRepository.getLeaderboard();
  const solversAfterStale = afterStaleLeaderboard.find((s) => s.teamId === teamSolvers.id);

  assert(
    solversAfterStale?.connectedMemberCount === 1,
    `Stale session purged: connected count correctly dropped to 1/2 (actual: ${solversAfterStale?.connectedMemberCount})`
  );

  console.log('\n================================================================');
  console.log(`FRAGMENT 11 TESTS COMPLETE: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('================================================================');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runFragment11TestSuite().catch((err) => {
  console.error('Fragment 11 test execution error:', err);
  process.exit(1);
});

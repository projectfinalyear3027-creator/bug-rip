/**
 * BUG SNIPER - Automated Validation: Match History, Deletion & Participant Code Draft Isolation
 *
 * Verifies:
 * 1. DRAFT ISOLATION across matches (Match A vs Match B)
 * 2. SAME-MATCH DRAFT RESTORATION (persists on reload within same match)
 * 3. CHALLENGE ISOLATION (Challenge X draft never leaks to Challenge Y)
 * 4. OLD LOCALSTORAGE MIGRATION/CLEANUP (unscoped legacy keys purged/ignored)
 * 5. HISTORICAL RESULT RETRIEVAL (persisted non-zero match results returned)
 * 6. MATCH ISOLATION (Match A history never contaminated by Match B or live state)
 * 7. DELETE ONE HISTORY (ended match deleted, details return not-found, participants/challenges preserved)
 * 8. CLEAR HISTORY (all ended matches purged, active match preserved)
 * 9. ACTIVE MATCH PROTECTION (cannot delete running/active match)
 * 10. DATABASE INTEGRITY (no orphan match-scoped records remain)
 */

process.env.PG_MEM = 'true';
process.env.SEED_TEST_FIXTURES = 'true';

import { db } from '../src/db/index.ts';
import { runMigrations } from '../database/migrator.ts';
import { runSeed } from '../database/seed.ts';
import { adminRepository } from '../backend/repositories/adminRepository.ts';
import { eventRepository } from '../backend/repositories/eventRepository.ts';
import { challengeRepository } from '../backend/repositories/challengeRepository.ts';
import {
  teams,
  participants,
  challenges,
  competitionMatches,
  eventSettings,
  adminUsers,
  submissions,
  flagSubmissions,
  antiCheatEvents,
  matchHistoricalChallenges,
} from '../src/db/schema.ts';
import { eq, or } from 'drizzle-orm';

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

// In-memory mock localStorage mimicking browser localStorage for client draft tests
class MockLocalStorage {
  private store: Map<string, string> = new Map();

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get length(): number {
    return this.store.size;
  }

  key(index: number): string | null {
    const keys = Array.from(this.store.keys());
    return keys[index] || null;
  }
}

// Client-side key derivation identical to ParticipantArena.tsx
function getDraftStorageKey(
  teamId: string,
  challengeId: string,
  matchId: string | null = null,
  matchNumber: number = 1
): string {
  const matchScope = matchId && matchId.trim() !== '' ? matchId : `m${matchNumber}`;
  return `bugrip_draft_${teamId}_${matchScope}_${challengeId}`;
}

function resolveEditorSource(
  storage: MockLocalStorage,
  teamId: string,
  challengeId: string,
  canonicalStarterCode: string,
  matchId: string | null = null,
  matchNumber: number = 1
): { source: string; hasDraft: boolean } {
  const draftKey = getDraftStorageKey(teamId, challengeId, matchId, matchNumber);
  const savedDraft = storage.getItem(draftKey);
  if (savedDraft !== null && savedDraft.trim() !== '') {
    return { source: savedDraft, hasDraft: true };
  }
  return { source: canonicalStarterCode, hasDraft: false };
}

function runClientStorageCleanup(storage: MockLocalStorage, teamId: string): void {
  const keysToRemove: string[] = [];
  const prefix = `bugrip_draft_${teamId}_`;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key) continue;
    if (key.startsWith(prefix)) {
      const suffix = key.slice(prefix.length);
      // Scoped format is: bugrip_draft_${teamId}_${matchScope}_${challengeId}
      if (!suffix.includes('_')) {
        keysToRemove.push(key);
      }
    }
    if (key === `bugrip_active_challenge_${teamId}`) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((k) => storage.removeItem(k));
}

async function runTestSuite() {
  console.log('\n================================================================');
  console.log('BUG SNIPER: MATCH HISTORY, DELETION & DRAFT ISOLATION TEST SUITE');
  console.log('================================================================');

  // Initialize DB and Seed Base Fixtures
  await runMigrations();
  await runSeed({ includeDemoParticipants: true });

  const adminList = await db.select().from(adminUsers).where(eq(adminUsers.username, 'admin')).limit(1);
  assert(adminList.length > 0, 'Super admin account found');
  const adminId = adminList[0].id;

  const testTeams = await db.select().from(teams).limit(3);
  assert(testTeams.length >= 2, 'At least 2 test teams available');
  const teamA = testTeams[0];
  const teamB = testTeams[1];

  // Retrieve an existing real participant from participants table
  const existingParticipants = await db.select().from(participants);
  let participantA = existingParticipants.find((p) => p.teamId === teamA.id);
  if (!participantA) {
    if (existingParticipants.length > 0) {
      participantA = existingParticipants[0];
    } else {
      const [newPart] = await db
        .insert(participants)
        .values({
          name: 'Real Test Competitor',
          participantCode: 'COMP-TEST-01',
          teamId: teamA.id,
          status: 'ACTIVE',
        })
        .returning();
      participantA = newPart;
    }
  }
  assert(Boolean(participantA?.id), 'Real participant fixture retrieved from participants table');

  const allChals = await challengeRepository.getChallenges();
  assert(allChals.length >= 2, 'Authoritative challenges loaded');
  const chal1 = allChals[0];
  const chal2 = allChals[1];

  // ===========================================================================
  // SECTION 1: PARTICIPANT CODE DRAFT ISOLATION & STORAGE SCOPING
  // ===========================================================================
  console.log('\n[1. Participant Code Draft Isolation Across Matches]');
  const mockStorage = new MockLocalStorage();

  const match1Number = 1;
  const match1Id = 'match-1-uuid-1111';
  const match2Number = 2;
  const match2Id = 'match-2-uuid-2222';

  const canonicalStarterChal1 = chal1.starterCode || '// canonical starter code for chal1';
  const editedDraftMatch1 = '// Modified Java solution by Participant X in Match 1\npublic class Solution { int fix = 42; }';

  // 1.1 Store draft in Match 1
  const m1KeyChal1 = getDraftStorageKey(teamA.id, chal1.id, match1Id, match1Number);
  mockStorage.setItem(m1KeyChal1, editedDraftMatch1);

  // Assert Match 1 retrieves edited draft
  const m1Result = resolveEditorSource(mockStorage, teamA.id, chal1.id, canonicalStarterChal1, match1Id, match1Number);
  assert(m1Result.hasDraft === true, 'Match 1 correctly identifies existing draft');
  assert(m1Result.source === editedDraftMatch1, 'Match 1 loads edited draft');

  // 1.2 Transition to Match 2: Draft from Match 1 MUST NOT appear in Match 2
  const m2Result = resolveEditorSource(mockStorage, teamA.id, chal1.id, canonicalStarterChal1, match2Id, match2Number);
  assert(m2Result.hasDraft === false, 'Match 2 has no draft for this challenge');
  assert(m2Result.source === canonicalStarterChal1, 'Match 2 strictly loads canonical starterCode from server');
  assert(!m2Result.source.includes('Match 1'), 'Match 2 editor does not leak Match 1 edits');

  console.log('\n[2. Same-Match Draft Restoration on Reload]');
  // 2.1 Reloading the editor in Match 1 restores the Match 1 draft
  const m1Reload = resolveEditorSource(mockStorage, teamA.id, chal1.id, canonicalStarterChal1, match1Id, match1Number);
  assert(m1Reload.hasDraft === true, 'Same match reload recognizes existing draft');
  assert(m1Reload.source === editedDraftMatch1, 'Same match reload restores edited code');

  console.log('\n[3. Challenge-to-Challenge Draft Isolation]');
  // 3.1 Chal1 has a draft in Match 1. Chal2 in Match 1 should load canonical starterCode
  const canonicalStarterChal2 = chal2.starterCode || '// canonical starter code for chal2';
  const chal2InM1 = resolveEditorSource(mockStorage, teamA.id, chal2.id, canonicalStarterChal2, match1Id, match1Number);
  assert(chal2InM1.hasDraft === false, 'Challenge 2 has no draft');
  assert(chal2InM1.source === canonicalStarterChal2, 'Challenge 2 loads canonical starterCode');
  assert(!chal2InM1.source.includes('Solution { int fix'), 'Challenge 1 draft does not contaminate Challenge 2');

  // 3.2 Save draft for Chal2, verify Chal1 draft remains isolated
  const editedChal2 = '// Distinct edit for Challenge 2';
  const m1KeyChal2 = getDraftStorageKey(teamA.id, chal2.id, match1Id, match1Number);
  mockStorage.setItem(m1KeyChal2, editedChal2);

  const chal1Check = resolveEditorSource(mockStorage, teamA.id, chal1.id, canonicalStarterChal1, match1Id, match1Number);
  const chal2Check = resolveEditorSource(mockStorage, teamA.id, chal2.id, canonicalStarterChal2, match1Id, match1Number);
  assert(chal1Check.source === editedDraftMatch1, 'Challenge 1 draft remains intact');
  assert(chal2Check.source === editedChal2, 'Challenge 2 draft remains intact and isolated');

  console.log('\n[4. Old Unscoped localStorage Key Migration / Cleanup]');
  // 4.1 Simulate legacy unscoped key: bugrip_draft_${team.id}_${challengeId}
  const legacyKey = `bugrip_draft_${teamA.id}_${chal1.id}`;
  const legacyActiveKey = `bugrip_active_challenge_${teamA.id}`;
  mockStorage.setItem(legacyKey, '// LEAKED LEGACY DRAFT FROM OLD BUGGY CODE');
  mockStorage.setItem(legacyActiveKey, chal1.id);
  assert(mockStorage.getItem(legacyKey) !== null, 'Legacy unscoped key created');

  // Run cleanup simulation
  runClientStorageCleanup(mockStorage, teamA.id);
  assert(mockStorage.getItem(legacyKey) === null, 'Legacy unscoped draft key was purged');
  assert(mockStorage.getItem(legacyActiveKey) === null, 'Legacy active challenge key was purged');
  assert(mockStorage.getItem(m1KeyChal1) === editedDraftMatch1, 'Properly scoped match draft was preserved');

  // Verify new match with clean slate does not load legacy code
  const freshMatchResult = resolveEditorSource(
    mockStorage,
    teamA.id,
    chal1.id,
    canonicalStarterChal1,
    'match-3-uuid-3333',
    3
  );
  assert(freshMatchResult.source === canonicalStarterChal1, 'Fresh match cleanly displays canonical starterCode');

  // ===========================================================================
  // SECTION 2: HISTORICAL MATCH RESULTS & STANDINGS
  // ===========================================================================
  console.log('\n[5. Historical Match Results & Persisted Values Retrieval]');
  // 5.1 Ensure Match 1 in DB has persisted non-zero final results
  const sampleLeaderboard = [
    {
      rank: 1,
      participantId: teamA.id,
      participantName: teamA.teamName,
      teamName: teamA.teamName,
      college: 'Cyber Institute',
      problemsSolved: 4,
      challengesSolved: 4,
      score: 120,
      totalScore: 120,
      lastSolveTimestamp: new Date().toISOString(),
    },
    {
      rank: 2,
      participantId: teamB.id,
      participantName: teamB.teamName,
      teamName: teamB.teamName,
      college: 'Tech Academy',
      problemsSolved: 2,
      challengesSolved: 2,
      score: 50,
      totalScore: 50,
      lastSolveTimestamp: new Date().toISOString(),
    },
  ];

  await db
    .update(competitionMatches)
    .set({
      status: 'ENDED',
      durationMinutes: 45,
      startedAt: new Date(Date.now() - 45 * 60 * 1000),
      endedAt: new Date(),
      finalLeaderboard: sampleLeaderboard,
      endedReason: 'Completed scheduled 45m competition run',
    })
    .where(eq(competitionMatches.matchNumber, 1));

  // Advance event settings to Match 2 so Match 1 is officially historical
  await db
    .update(eventSettings)
    .set({
      currentMatchNumber: 2,
      status: 'RUNNING',
    })
    .where(eq(eventSettings.id, 1));

  // Fetch Match 1 via adminRepository.getMatchDetails
  const match1Details = await adminRepository.getMatchDetails(1);
  assert(match1Details !== null, 'Match 1 details returned');
  assert(match1Details?.matchNumber === 1, 'Details belong to Match #1');
  assert(match1Details?.status === 'ENDED', 'Match 1 status is ENDED');
  assert(match1Details?.isArchived === true, 'Match 1 flagged as archived');
  assert(match1Details?.hasHistoricalData === true, 'Match 1 flagged with valid historical data');
  assert(match1Details?.participantCount === 2, `Exact participant count returned (expected 2, got ${match1Details?.participantCount})`);
  assert(match1Details?.totalSolves === 6, `Exact total solves returned: 4 + 2 = 6 (got ${match1Details?.totalSolves})`);
  assert(match1Details?.finalLeaderboard.length === 2, 'Final leaderboard has 2 entries');
  assert(match1Details?.finalLeaderboard[0].score === 120, 'Rank 1 score is 120');
  assert(match1Details?.finalLeaderboard[1].score === 50, 'Rank 2 score is 50');

  // Verify adminRepository.getMatchLeaderboard returns exact same persisted data
  const match1Lb = await adminRepository.getMatchLeaderboard(1);
  assert(match1Lb !== null && match1Lb.leaderboard.length === 2, 'getMatchLeaderboard returns archived leaderboard');
  assert(match1Lb?.leaderboard[0].score === 120, 'getMatchLeaderboard rank 1 score matches 120');

  console.log('\n[6. Match Isolation: Match A vs Match B]');
  // 6.1 Create historical Match 2 with completely different results
  const sampleLeaderboardMatch2 = [
    {
      rank: 1,
      participantId: teamB.id,
      participantName: teamB.teamName,
      teamName: teamB.teamName,
      college: 'Tech Academy',
      problemsSolved: 7,
      score: 250,
      totalScore: 250,
      lastSolveTimestamp: new Date().toISOString(),
    },
  ];

  await db
    .insert(competitionMatches)
    .values({
      matchNumber: 2,
      name: 'Match 2 - Semifinals',
      status: 'ENDED',
      durationMinutes: 60,
      startedAt: new Date(Date.now() - 60 * 60 * 1000),
      endedAt: new Date(),
      finalLeaderboard: sampleLeaderboardMatch2,
    })
    .onConflictDoUpdate({
      target: competitionMatches.matchNumber,
      set: {
        status: 'ENDED',
        finalLeaderboard: sampleLeaderboardMatch2,
      },
    });

  // Advance event settings to active Match 3
  await db
    .insert(competitionMatches)
    .values({
      matchNumber: 3,
      name: 'Match 3 - Active Live Round',
      status: 'RUNNING',
      durationMinutes: 60,
    })
    .onConflictDoUpdate({
      target: competitionMatches.matchNumber,
      set: { status: 'RUNNING' },
    });

  await db
    .update(eventSettings)
    .set({
      currentMatchNumber: 3,
      status: 'RUNNING',
    })
    .where(eq(eventSettings.id, 1));

  // Query Match 1 again
  const match1Isolated = await adminRepository.getMatchDetails(1);
  assert(match1Isolated?.matchNumber === 1, 'Querying Match 1 returns Match 1');
  assert(match1Isolated?.finalLeaderboard[0].participantId === teamA.id, 'Match 1 winner remains Team A (120 pts)');
  assert(match1Isolated?.finalLeaderboard[0].score === 120, 'Match 1 score has not been overwritten by Match 2 or active Match 3');

  // Query Match 2
  const match2Isolated = await adminRepository.getMatchDetails(2);
  assert(match2Isolated?.matchNumber === 2, 'Querying Match 2 returns Match 2');
  assert(match2Isolated?.finalLeaderboard[0].participantId === teamB.id, 'Match 2 winner is Team B (250 pts)');
  assert(match2Isolated?.finalLeaderboard[0].score === 250, 'Match 2 score is isolated from Match 1');

  // ===========================================================================
  // SECTION 3: ADMIN DELETE ONE HISTORY
  // ===========================================================================
  console.log('\n[7. Delete One Completed Historical Match]');
  // 7.1 Seed a dummy submission and challenge completion for Match 1 to verify cascading cleanup
  await db.insert(submissions).values({
    teamId: teamA.id,
    participantId: participantA.id,
    challengeId: chal1.id,
    matchNumber: 1,
    sourceCode: 'public class M1Dummy {}',
    executionStatus: 'SUCCESS',
  });

  await db.insert(matchHistoricalChallenges).values({
    matchNumber: 1,
    teamId: teamA.id,
    challengeId: chal1.id,
    status: 'COMPLETED',
  });

  const m1SubsBefore = await db.select().from(submissions).where(eq(submissions.matchNumber, 1));
  assert(m1SubsBefore.length >= 1, 'Match 1 submission created before deletion');

  // Delete Match 1 using adminRepository.deleteMatch
  const del1Result = await adminRepository.deleteMatch(1, adminId);
  assert(del1Result.success === true, 'adminRepository.deleteMatch succeeded for Match 1');
  assert(del1Result.match?.matchNumber === 1, 'Deleted match was Match 1');

  // 7.2 Verify Match 1 is gone from match list and detail returns null
  const allMatchesAfterDel = await adminRepository.getMatches();
  assert(!allMatchesAfterDel.some((m) => m.matchNumber === 1), 'Match 1 no longer appears in match history list');

  const match1AfterDel = await adminRepository.getMatchDetails(1);
  assert(match1AfterDel === null, 'Match 1 details return null (404 not found)');

  const match1LbAfterDel = await adminRepository.getMatchLeaderboard(1);
  assert(match1LbAfterDel === null, 'Match 1 leaderboard returns null (404 not found)');

  // 7.3 Verify registrations and challenge definitions are intact
  const teamsAfterDel1 = await db.select().from(teams);
  assert(teamsAfterDel1.length >= testTeams.length, `Team registrations preserved (${teamsAfterDel1.length})`);

  const participantsAfterDel1 = await db.select().from(participants);
  assert(participantsAfterDel1.length >= 1, `Participant registrations preserved (${participantsAfterDel1.length})`);

  const challengesAfterDel1 = await challengeRepository.getChallenges();
  assert(challengesAfterDel1.length >= allChals.length, `Challenge definitions preserved (${challengesAfterDel1.length})`);

  // 7.4 Verify match-scoped submissions & historical challenges for Match 1 were cleaned up
  const m1SubsAfter = await db.select().from(submissions).where(eq(submissions.matchNumber, 1));
  assert(m1SubsAfter.length === 0, 'Match 1 historical submissions purged cleanly');

  const m1HistChalsAfter = await db.select().from(matchHistoricalChallenges).where(eq(matchHistoricalChallenges.matchNumber, 1));
  assert(m1HistChalsAfter.length === 0, 'Match 1 historical challenge completions purged cleanly');

  // ===========================================================================
  // SECTION 4: CLEAR ALL COMPLETED HISTORICAL MATCHES
  // ===========================================================================
  console.log('\n[8. Clear All Completed Historical Matches While Preserving Active Match]');
  // Create an extra historical match: Match 4 (ENDED) alongside Match 2 (ENDED)
  await db.insert(competitionMatches).values({
    matchNumber: 4,
    name: 'Match 4 - Historical Archive',
    status: 'ENDED',
    durationMinutes: 30,
    finalLeaderboard: [{ rank: 1, participantName: 'Solo Solver', score: 30 }],
  });

  const matchesBeforeClear = await adminRepository.getMatches();
  assert(matchesBeforeClear.length >= 3, 'At least 3 matches in DB before clear history (Matches 2, 3, 4)');

  // Clear all archived matches
  const clearResult = await adminRepository.clearArchivedMatches(adminId);
  assert(clearResult.success === true, 'clearArchivedMatches succeeded');
  assert(clearResult.deletedCount >= 2, `Cleared at least 2 historical matches (actual: ${clearResult.deletedCount})`);

  // Assert active match (Match 3) remains
  const matchesAfterClear = await adminRepository.getMatches();
  assert(matchesAfterClear.length === 1, `Exactly 1 match remaining (actual: ${matchesAfterClear.length})`);
  assert(matchesAfterClear[0].matchNumber === 3, 'The single remaining match is the active Match #3');
  assert(matchesAfterClear[0].status === 'RUNNING', 'Active match remains in RUNNING state');

  // Verify registrations & challenges still preserved
  const teamsAfterClear = await db.select().from(teams);
  assert(teamsAfterClear.length >= testTeams.length, 'Teams preserved after clear history');
  const chalsAfterClear = await challengeRepository.getChallenges();
  assert(chalsAfterClear.length >= allChals.length, 'Challenges preserved after clear history');

  // ===========================================================================
  // SECTION 5: ACTIVE MATCH DELETION PROTECTION
  // ===========================================================================
  console.log('\n[9. Active Match Deletion Protection]');
  // 9.1 Attempt to delete the currently active Match 3
  const illegalActiveDelete = await adminRepository.deleteMatch(3, adminId);
  assert(illegalActiveDelete.success === false, 'Deleting active match is strictly rejected');
  assert(illegalActiveDelete.code === 'CANNOT_DELETE_ACTIVE_MATCH', `Correct error code returned: ${illegalActiveDelete.code}`);
  assert(illegalActiveDelete.statusCode === 400, 'Rejection returned HTTP 400 status');

  // Verify Match 3 is still active and alive in DB
  const match3StillActive = await adminRepository.getMatchDetails(3);
  assert(match3StillActive !== null, 'Active Match 3 remains intact in database');
  assert(match3StillActive?.matchNumber === 3, 'Match 3 details accessible');

  // 9.2 Attempt to delete a non-existent match
  const nonExistentDelete = await adminRepository.deleteMatch(999, adminId);
  assert(nonExistentDelete.success === false, 'Deleting non-existent match fails');
  assert(nonExistentDelete.code === 'MATCH_NOT_FOUND', 'Returns MATCH_NOT_FOUND error code');
  assert(nonExistentDelete.statusCode === 404, 'Returns 404 status code');

  // ===========================================================================
  // SECTION 6: DATABASE INTEGRITY VERIFICATION
  // ===========================================================================
  console.log('\n[10. Database Integrity: No Orphan Match Records]');
  const remainingMatches = await db.select().from(competitionMatches);
  const remainingMatchNumbers = new Set(remainingMatches.map((m) => m.matchNumber));

  // Check submissions
  const allSubmissions = await db.select().from(submissions);
  const orphanSubs = allSubmissions.filter((s) => !remainingMatchNumbers.has(s.matchNumber));
  assert(orphanSubs.length === 0, `No orphan submissions found (orphans: ${orphanSubs.length})`);

  // Check flag submissions
  const allFlags = await db.select().from(flagSubmissions);
  const orphanFlags = allFlags.filter((f) => !remainingMatchNumbers.has(f.matchNumber));
  assert(orphanFlags.length === 0, `No orphan flag submissions found (orphans: ${orphanFlags.length})`);

  // Check anti-cheat events
  const allAntiCheat = await db.select().from(antiCheatEvents);
  const orphanAntiCheat = allAntiCheat.filter((a) => !remainingMatchNumbers.has(a.matchNumber));
  assert(orphanAntiCheat.length === 0, `No orphan anti-cheat events found (orphans: ${orphanAntiCheat.length})`);

  // Check historical challenges
  const allHistChals = await db.select().from(matchHistoricalChallenges);
  const orphanHistChals = allHistChals.filter((h) => !remainingMatchNumbers.has(h.matchNumber));
  assert(orphanHistChals.length === 0, `No orphan historical challenge records found (orphans: ${orphanHistChals.length})`);

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  console.log('\n================================================================');
  console.log(`MATCH HISTORY & DRAFT ISOLATION SUMMARY: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('================================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runTestSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });

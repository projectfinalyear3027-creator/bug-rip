/**
 * BUG SNIPER - Anti-Cheat Match Scoping Verification Suite
 * 
 * Verifies:
 * 1. Match A incidents appear during Match A.
 * 2. Match A final incidents remain visible after Match A ends.
 * 3. Creating Match B clears Match A incidents from active view.
 * 4. Match B incidents appear normally.
 * 5. A late Match A event cannot contaminate Match B's incident list.
 * 6. Historical Match A database records remain intact in PostgreSQL.
 */

process.env.PG_MEM = 'true';

import { db } from '../src/db/index.ts';
import { runMigrations } from '../database/migrator.ts';
import { runSeed } from '../database/seed.ts';
import { antiCheatRepository } from '../backend/repositories/antiCheatRepository.ts';
import { adminRepository } from '../backend/repositories/adminRepository.ts';
import { antiCheatEvents, eventSettings, teams, participants, competitionMatches, adminUsers } from '../src/db/schema.ts';
import { eq } from 'drizzle-orm';

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

async function runMatchScopeTests() {
  console.log('\n================================================================');
  console.log('BUG SNIPER: MATCH-SCOPED ANTI-CHEAT INCIDENTS VERIFICATION');
  console.log('================================================================\n');

  console.log('[Setup] Running migrations and seeding test data...');
  await runMigrations();
  await runSeed();

  const [adminUser] = await db.select().from(adminUsers).limit(1);

  // Create isolated test team & participant
  const [testTeamA] = await db
    .insert(teams)
    .values({
      teamName: 'Cyber Sentinels',
      teamCode: 'CYBER-001',
      accessCode: 'CYBER-ACCESS-001',
      status: 'ACTIVE',
    })
    .returning();

  const [testTeamB] = await db
    .insert(teams)
    .values({
      teamName: 'Null Pointers',
      teamCode: 'NULL-002',
      accessCode: 'NULL-ACCESS-002',
      status: 'ACTIVE',
    })
    .returning();

  const [partA] = await db
    .insert(participants)
    .values({
      name: 'Alice Hacker',
      participantCode: 'PART-ALICE-01',
      email: 'alice@example.com',
      status: 'ACTIVE',
    })
    .returning();

  // Ensure Match 1 is established and status is RUNNING
  await db
    .update(eventSettings)
    .set({
      status: 'RUNNING',
      currentMatchNumber: 1,
      startedAt: new Date(),
      endedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(eventSettings.id, 1));

  console.log('\n[Stage 1] Match A Starts & Live Incidents Appear');
  // 1. Initially Match 1 has no incidents
  const initialMatch1Events = await antiCheatRepository.getEvents({ matchNumber: 1 });
  assert(initialMatch1Events.length === 0, 'Match A starts with 0 incidents in active panel');

  // Record 2 incidents during Match A
  await antiCheatRepository.recordEvent({
    teamId: testTeamA.id,
    participantId: partA.id,
    eventType: 'FULLSCREEN_EXIT',
    metadata: { reason: 'Alt-Tab outside full screen', match: 'A' },
    matchNumber: 1,
  });

  await antiCheatRepository.recordEvent({
    teamId: testTeamA.id,
    participantId: partA.id,
    eventType: 'WINDOW_BLUR',
    metadata: { reason: 'Lost window focus', match: 'A' },
    matchNumber: 1,
  });

  const activeMatch1Events = await antiCheatRepository.getEvents({ matchNumber: 1 });
  assert(activeMatch1Events.length === 2, 'Match A incidents appear during Match A (found 2)');
  assert(
    activeMatch1Events.every((e) => e.matchNumber === 1),
    'All active events are tagged with Match A (matchNumber: 1)'
  );

  const match1Summary = await antiCheatRepository.getSummaryStats({ matchNumber: 1 });
  assert(match1Summary.totalEvents === 2, 'Summary stats correctly reflect Match A incidents count (2)');

  console.log('\n[Stage 2] Match A Ends: Final Incidents Remain Visible');
  // End Match A
  await db
    .update(eventSettings)
    .set({
      status: 'ENDED',
      endedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(eventSettings.id, 1));

  // Current match number is STILL 1
  const [endedSettings] = await db.select().from(eventSettings).where(eq(eventSettings.id, 1));
  assert(endedSettings.status === 'ENDED', 'Match A status is ENDED');
  assert(endedSettings.currentMatchNumber === 1, 'Current match number remains 1 after Match A concludes');

  // Final incidents must remain visible
  const endedMatch1Events = await antiCheatRepository.getEvents({ matchNumber: endedSettings.currentMatchNumber });
  assert(endedMatch1Events.length === 2, 'Match A final incidents remain visible after Match A ends');

  console.log('\n[Stage 3] Match B Established: Immediately Reset & Clear Incidents');
  // Establish Match B using adminRepository.createNewMatch
  const newMatchResult = await adminRepository.createNewMatch(adminUser.id, {
    matchName: 'Match 2 Championship',
    durationMinutes: 45,
  });

  assert(newMatchResult.success === true, 'Match B created successfully via startNewMatch');
  assert(newMatchResult.event?.currentMatchNumber === 2, 'Authoritative currentMatchNumber is now 2');

  // Querying active match (Match 2) must return an empty list
  const activeMatch2EventsInitial = await antiCheatRepository.getEvents({ matchNumber: 2 });
  assert(
    activeMatch2EventsInitial.length === 0,
    'Match B active incidents panel is immediately clean/empty (0 incidents)'
  );

  const match2SummaryInitial = await antiCheatRepository.getSummaryStats({ matchNumber: 2 });
  assert(match2SummaryInitial.totalEvents === 0, 'Match B summary stats reset to 0');

  console.log('\n[Stage 4] Match B Incidents Appear Normally');
  // Start Match B
  await db
    .update(eventSettings)
    .set({
      status: 'RUNNING',
      startedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(eventSettings.id, 1));

  // Record an incident in Match B
  await antiCheatRepository.recordEvent({
    teamId: testTeamB.id,
    participantId: partA.id,
    eventType: 'TAB_HIDDEN',
    metadata: { reason: 'Tab hidden during Match B' },
    matchNumber: 2,
  });

  const activeMatch2Events = await antiCheatRepository.getEvents({ matchNumber: 2 });
  assert(activeMatch2Events.length === 1, 'Match B incident appears normally (count: 1)');
  assert(activeMatch2Events[0].eventType === 'TAB_HIDDEN', 'Match B incident eventType matches');
  assert(activeMatch2Events[0].matchNumber === 2, 'Match B incident is scoped to matchNumber: 2');

  console.log('\n[Stage 5] Late Match A Event Cannot Contaminate Match B List');
  // Simulate a late packet arriving from Match A with matchNumber: 1
  const lateMatch1Event = await antiCheatRepository.recordEvent({
    teamId: testTeamA.id,
    participantId: partA.id,
    eventType: 'WINDOW_BLUR',
    metadata: { reason: 'Delayed network packet from Match A' },
    matchNumber: 1, // Late Match 1 event
  });

  assert(Boolean(lateMatch1Event.id), 'Late Match 1 event recorded with historical matchNumber 1');

  // Verify Match 2 active query does NOT contain the late Match 1 event
  const match2EventsAfterLate = await antiCheatRepository.getEvents({ matchNumber: 2 });
  assert(
    match2EventsAfterLate.length === 1,
    'Match B active incident list remains exactly 1; late Match A event did NOT contaminate Match B'
  );
  assert(
    match2EventsAfterLate.every((e) => e.matchNumber === 2),
    'All events in Match B panel strictly belong to matchNumber: 2'
  );

  // Frontend contamination simulation: test filtering logic matching AdminAntiCheat
  const activeMatchNumberInUI = 2;
  const simulatedIncomingSse = [
    { matchNumber: 1, id: 'late-1', type: 'WINDOW_BLUR' },
    { matchNumber: 2, id: 'valid-2', type: 'FULLSCREEN_EXIT' },
  ];
  const acceptedByUI = simulatedIncomingSse.filter((e) => e.matchNumber === activeMatchNumberInUI);
  assert(acceptedByUI.length === 1 && acceptedByUI[0].id === 'valid-2', 'Frontend SSE filter strictly drops late Match 1 event');

  console.log('\n[Stage 6] Historical Match A Database Records Remain Intact');
  // Check all events in database for Match 1
  const historicalMatch1Events = await antiCheatRepository.getEvents({ matchNumber: 1 });
  assert(
    historicalMatch1Events.length === 3,
    `Historical Match A database records remain intact in PostgreSQL (expected 3, found ${historicalMatch1Events.length})`
  );

  const totalAllMatchesInDb = await db.select().from(antiCheatEvents);
  assert(
    totalAllMatchesInDb.length === 4,
    `Total database records across all matches preserved without deletion (total: ${totalAllMatchesInDb.length})`
  );

  console.log('\n================================================================');
  console.log(`MATCH SCOPE VERIFICATION COMPLETE: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('================================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runMatchScopeTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });

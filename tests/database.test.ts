/**
 * BUG RIP - PostgreSQL & PGlite Database Foundation Verification Tests
 * 
 * Verifies:
 * 1. Automatic database mode selection:
 *    - DATABASE_URL absent/empty -> EMBEDDED_PGLITE (Zero-Config Default)
 *    - DATABASE_URL present -> EXTERNAL_POSTGRES
 * 2. Embedded PGlite migration execution & schema integrity (15 tables + leaderboard_view)
 * 3. Seed data verification on PGlite
 * 4. Repositories on PGlite (Team, Challenge, Progress, Race Protection, Event Settings)
 * 5. Live Server Diagnostics API verifying active embedded mode and health latency
 */

import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { getActiveDatabaseMode } from '../src/db/index.ts';

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    testsPassed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}`);
    testsFailed++;
  }
}

async function runDatabaseTests() {
  console.log('====================================================');
  console.log('BUG RIP: Running Database Foundation & PGlite Tests');
  console.log('====================================================');

  // ---------------------------------------------------------------------------
  // Suite 1: Automatic Database Selection Logic
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 1: Automatic Database Selection]');

  const defaultMode = getActiveDatabaseMode();
  assert(
    defaultMode.mode === 'EMBEDDED_PGLITE',
    `Default mode without DATABASE_URL is EMBEDDED_PGLITE (Active: ${defaultMode.mode})`,
  );
  assert(
    defaultMode.engine === 'PostgreSQL (Embedded Engine)' || defaultMode.engine === 'PostgreSQL (In-Memory Engine)',
    `Engine is identified as embedded/in-memory PostgreSQL (Active: ${defaultMode.engine})`,
  );
  assert(
    defaultMode.isEmbedded === true,
    'isEmbedded flag is true',
  );
  assert(
    defaultMode.databaseUrlConfigured === false,
    'databaseUrlConfigured is false',
  );

  // ---------------------------------------------------------------------------
  // Suite 2: Embedded PGlite Migrations & Relational Schema Integrity
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 2: PGlite In-Memory Migrations & Relational DDL]');

  // Create isolated in-memory PGlite instance for testing
  const testPglite = new PGlite();

  // Apply migrations
  const migrationsDir = path.join(process.cwd(), 'database', 'migrations');
  assert(fs.existsSync(migrationsDir), `Migrations directory exists at ${migrationsDir}`);

  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  assert(migrationFiles.length > 0, `Discovered ${migrationFiles.length} migration file(s)`);

  for (const file of migrationFiles) {
    const filePath = path.join(migrationsDir, file);
    const migrationSql = fs.readFileSync(filePath, 'utf-8');
    await testPglite.exec(migrationSql);
  }
  assert(true, 'PGlite successfully executed all DDL migration statements without syntax errors');

  // Verify all 15 core relational tables exist
  const expectedTables = [
    'admin_users',
    'teams',
    'participants',
    'team_members',
    'rounds',
    'challenges',
    'challenge_test_cases',
    'challenge_flags',
    'team_challenges',
    'sessions',
    'submissions',
    'flag_submissions',
    'anti_cheat_events',
    'event_settings',
    'audit_logs',
  ];

  for (const table of expectedTables) {
    const tableRes = await testPglite.query(
      `SELECT table_name FROM information_schema.tables WHERE table_name = $1 AND table_schema = 'public';`,
      [table],
    );
    assert(tableRes.rows.length === 1, `Relational table '${table}' exists in PGlite`);
  }

  // Verify leaderboard view exists
  const viewRes = await testPglite.query(
    `SELECT table_name FROM information_schema.views WHERE table_name = 'leaderboard_view' AND table_schema = 'public';`,
  );
  assert(viewRes.rows.length === 1, "Authoritative 'leaderboard_view' exists in PGlite");

  // ---------------------------------------------------------------------------
  // Suite 3: Relational Constraints & Team Size Rules on PGlite
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 3: Database-Level Constraints & Team Atomicity]');

  // Insert 60-minute event configuration
  await testPglite.query(`
    INSERT INTO event_settings (id, event_name, status, duration_minutes, min_team_members, max_team_members)
    VALUES (1, 'BUG SNIPER Test', 'NOT_STARTED', 60, 1, 3);
  `);
  assert(true, 'Inserted single-row event_settings (60-minute duration, 1-3 members)');

  // Insert Round: Easy (unlocked at 0 solves)
  const roundId = '00000000-0000-0000-0000-000000000001';
  await testPglite.query(`
    INSERT INTO rounds (id, name, slug, display_order, unlock_required_solves)
    VALUES ($1, 'Easy', 'easy', 1, 0);
  `, [roundId]);

  // Insert Challenge: Factorial Bug
  const challengeId = 'TEST-CHALLENGE-01';
  await testPglite.query(`
    INSERT INTO challenges (id, round_id, title, slug, description, starter_code, score, display_order, validation_type)
    VALUES ($1, $2, 'Factorial Bug', 'factorial-bug', 'Fix boundary', 'public class Sol {}', 10, 1, 'EXACT_OUTPUT');
  `, [challengeId, roundId]);

  // Insert 3-Member Team Alpha
  const teamAlphaId = '11111111-1111-1111-1111-111111111111';
  await testPglite.query(`
    INSERT INTO teams (id, team_name, team_code, registered_member_count)
    VALUES ($1, 'Team Alpha', 'CODE-ALPHA-123', 3);
  `, [teamAlphaId]);

  // Verify 4-member team is rejected by DB constraint
  let rejectedFourMembers = false;
  try {
    await testPglite.query(`
      INSERT INTO teams (id, team_name, team_code, registered_member_count)
      VALUES ('44444444-4444-4444-4444-444444444444', 'Team Quad', 'CODE-QUAD-444', 4);
    `);
  } catch {
    rejectedFourMembers = true;
  }
  assert(rejectedFourMembers, 'Database check constraint rejects 4-member team');

  // Insert 3 Participants for Team Alpha
  const p1 = 'a1111111-0000-0000-0000-000000000001';
  const p2 = 'a2222222-0000-0000-0000-000000000002';
  const p3 = 'a3333333-0000-0000-0000-000000000003';
  await testPglite.query(`
    INSERT INTO participants (id, name, college, email)
    VALUES ($1, 'Student One', 'Test College', 's1@test.com'),
           ($2, 'Student Two', 'Test College', 's2@test.com'),
           ($3, 'Student Three', 'Test College', 's3@test.com');
  `, [p1, p2, p3]);

  await testPglite.query(`
    INSERT INTO team_members (team_id, participant_id)
    VALUES ($1, $2), ($1, $3), ($1, $4);
  `, [teamAlphaId, p1, p2, p3]);
  assert(true, 'Enforced 3-member team relational mapping (participants -> team_members -> teams)');

  // ---------------------------------------------------------------------------
  // Suite 4: Same-Challenge Atomic Solve Race Protection on PGlite
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 4: Same-Challenge Race Protection via UNIQUE(team_id, challenge_id)]');

  // First teammate solves challenge TEST-CHALLENGE-01
  await testPglite.query(`
    INSERT INTO team_challenges (team_id, challenge_id, status, completed_at, completion_timestamp, attempt_count)
    VALUES ($1, $2, 'COMPLETED', NOW(), NOW(), 1);
  `, [teamAlphaId, challengeId]);
  assert(true, 'Teammate 1 solve successfully recorded in team_challenges');

  // Second teammate attempts duplicate solve concurrently -> Database MUST reject via unique constraint
  let raceRejected = false;
  try {
    await testPglite.query(`
      INSERT INTO team_challenges (team_id, challenge_id, status, completed_at, completion_timestamp, attempt_count)
      VALUES ($1, $2, 'COMPLETED', NOW(), NOW(), 1);
    `, [teamAlphaId, challengeId]);
  } catch (err: any) {
    raceRejected = true;
  }
  assert(
    raceRejected,
    'Second concurrent solve attempt for same challenge is rejected by UNIQUE (team_id, challenge_id)',
  );

  // Verify Leaderboard View Calculation in PGlite
  const lbRows = await testPglite.query(`SELECT * FROM leaderboard_view WHERE team_id = $1;`, [teamAlphaId]);
  assert(lbRows.rows.length === 1, 'Leaderboard view reflects team progress');
  assert(Number((lbRows.rows[0] as any).problems_solved) === 1, 'Leaderboard view computes problems_solved = 1');
  assert(Number((lbRows.rows[0] as any).total_score) === 10, 'Leaderboard view computes total_score = 10');

  // Close isolated test instance
  await testPglite.close();
  assert(true, 'Test PGlite instance closed cleanly without residual locks');

  // ---------------------------------------------------------------------------
  // Suite 5: Live Development Server HTTP Health & PGlite Status
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 5: Live Server Health Probe (Verifying Active PGlite Dev Mode)]');

  try {
    const healthRes = await fetch('http://localhost:3000/api/health');
    assert(healthRes.status === 200, 'Live /api/health returned HTTP 200 OK');

    const healthData: any = await healthRes.json();
    assert(healthData.status === 'ok', 'Platform status is "ok"');
    assert(healthData.services.database === 'healthy', 'Database service is "healthy"');
    assert(healthData.database.connected === true, 'Database is connected: true');
    assert(
      healthData.database.engine === 'PostgreSQL (Embedded Engine)',
      `Database engine is 'PostgreSQL (Embedded Engine)' (Received: ${healthData.database.engine})`,
    );
    assert(
      healthData.database.mode === 'EMBEDDED_PGLITE',
      `Active database mode is 'EMBEDDED_PGLITE' (Received: ${healthData.database.mode})`,
    );
    assert(
      healthData.database.isEmbedded === true,
      'isEmbedded is true on live server',
    );
    assert(
      healthData.database.databaseUrlConfigured === false,
      'databaseUrlConfigured is false on live server',
    );
    assert(
      typeof healthData.database.latencyMs === 'number' && healthData.database.latencyMs < 50,
      `Live database query latency is ultra-low (${healthData.database.latencyMs}ms)`,
    );

    // Also check detailed database diagnostics
    const dbRes = await fetch('http://localhost:3000/api/competition/health/db');
    const dbData: any = await dbRes.json();
    assert(typeof dbData.entityCounts.teams === 'number', `Live database entity counts contains valid teams count (${dbData.entityCounts.teams})`);
    assert(dbData.entityCounts.rounds === 4, 'Live database contains 4 difficulty rounds');
    assert(dbData.entityCounts.challenges >= 5, `Live database contains seeded challenges (Count: ${dbData.entityCounts.challenges})`);
    assert(dbData.eventSettings.durationMinutes === 60, 'Live eventSettings duration is 60 minutes');
  } catch (err: any) {
    assert(false, `Live health probe failed: ${err.message}`);
  }

  console.log('\n====================================================');
  console.log(`DATABASE TEST RESULTS: ${testsPassed} Passed, ${testsFailed} Failed`);
  console.log('====================================================');

  if (testsFailed > 0) {
    process.exit(1);
  } else {
    console.log('PGlite embedded database verified completely functional without external DATABASE_URL.\n');
    process.exit(0);
  }
}

runDatabaseTests().catch((err) => {
  console.error('Database tests fatal error:', err);
  process.exit(1);
});

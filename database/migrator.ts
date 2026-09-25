/**
 * BUG RIP - PostgreSQL Database Migration Runner
 * Applies SQL migrations transactionally and idempotently with a persistent ledger.
 */

import fs from 'fs';
import path from 'path';
import { executeRawSql, checkDatabaseHealth, closeDatabase } from '../src/db/index.ts';

export async function runMigrations() {
  console.log('----------------------------------------------------');
  console.log('BUG SNIPER: Executing Database Migrations');
  console.log('----------------------------------------------------');

  const health = await checkDatabaseHealth();
  console.log(`Target Engine: ${health.engine} (Connected: ${health.connected})`);
  if (!health.connected) {
    throw new Error(`Database connection failed prior to migration: ${health.error || 'Connection failed'}`);
  }

  const migrationsDir = path.join(process.cwd(), 'database', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found at: ${migrationsDir}`);
  }

  // 1. Ensure schema_migrations ledger exists
  await executeRawSql(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // 2. Discover migrations in sorted order
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  // 3. Read already applied migrations from ledger
  const appliedRows = await executeRawSql('SELECT filename FROM schema_migrations;');
  const appliedFiles = new Set<string>(
    (appliedRows || []).map((row: any) => row.filename || row.FILENAME)
  );

  console.log(`Discovered ${files.length} migration file(s). ${appliedFiles.size} recorded in ledger.`);

  let appliedCount = 0;
  let skippedCount = 0;

  for (const file of files) {
    if (appliedFiles.has(file)) {
      skippedCount++;
      continue;
    }

    const filePath = path.join(migrationsDir, file);
    console.log(`Applying migration: ${file}...`);
    const sqlContent = fs.readFileSync(filePath, 'utf-8');

    try {
      await executeRawSql(sqlContent);
      // Record successful migration only after execution succeeds
      await executeRawSql(
        'INSERT INTO schema_migrations (filename, applied_at) VALUES ($1, NOW()) ON CONFLICT (filename) DO NOTHING;',
        [file]
      );
      appliedFiles.add(file);
      appliedCount++;
      console.log(`✓ Migration applied and recorded: ${file}`);
    } catch (migErr: any) {
      console.error(`❌ Migration FAILED: ${file}`);
      console.error('Error message:', migErr?.message);
      if (migErr?.cause) {
        console.error('Cause:', migErr.cause);
      }
      throw new Error(`Migration ${file} failed: ${migErr?.message || migErr}`, { cause: migErr });
    }
  }

  console.log(`Migration summary: ${appliedCount} applied, ${skippedCount} skipped (already recorded), total ${files.length}.`);
}

// Allow standalone execution via `tsx database/migrator.ts`
if (
  process.argv[1]?.endsWith('database/migrator.ts') ||
  process.argv[1]?.endsWith('migrator.ts')
) {
  runMigrations()
    .then(() => {
      console.log('Migration process finished.');
      closeDatabase().catch(() => {});
      setTimeout(() => process.exit(0), 100);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

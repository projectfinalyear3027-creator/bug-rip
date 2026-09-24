/**
 * BUG RIP - PostgreSQL Database Migration Runner
 * Applies SQL migrations transactionally and idempotently.
 */

import fs from 'fs';
import path from 'path';
import { executeRawSql, checkDatabaseHealth } from '../src/db/index.ts';

export async function runMigrations() {
  console.log('----------------------------------------------------');
  console.log('BUG SNIPER: Executing Database Migrations');
  console.log('----------------------------------------------------');

  const health = await checkDatabaseHealth();
  console.log(`Target Engine: ${health.engine} (Connected: ${health.connected})`);

  const migrationsDir = path.join(process.cwd(), 'database', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found at: ${migrationsDir}`);
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  console.log(`Discovered ${files.length} migration file(s).`);

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    console.log(`Applying migration: ${file}...`);
    const sqlContent = fs.readFileSync(filePath, 'utf-8');

    try {
      await executeRawSql(sqlContent);
      console.log(`✓ Migration applied: ${file}`);
    } catch (migErr: any) {
      console.error(`❌ Migration FAILED: ${file}`);
      console.error('Error message:', migErr?.message);
      if (migErr?.cause) {
        console.error('Cause:', migErr.cause);
      }
      throw migErr;
    }
  }

  console.log('All migrations completed successfully.');
}

// Allow standalone execution via `tsx database/migrator.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => {
      console.log('Migration process finished.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

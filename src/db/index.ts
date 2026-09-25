/**
 * BUG RIP - Database Connection & ORM Initialization
 * Supports both PostgreSQL connection pooling (pg.Pool) and Embedded PostgreSQL (PGlite)
 * with robust error handling, connection caching, and schema exports.
 */

import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import * as schema from './schema.ts';
import fs from 'fs';
import path from 'path';

const { Pool } = pg;

// Global instance cache across module reloads
declare global {
  var _bugripPgPool: pg.Pool | undefined;
  var _bugripPglite: PGlite | undefined;
  var _bugripDrizzleDb: any | undefined;
}

export type DatabaseMode = 'EMBEDDED_PGLITE' | 'EXTERNAL_POSTGRES' | 'CLOUD_SQL';

export interface ActiveDatabaseInfo {
  mode: DatabaseMode;
  engine: string;
  isEmbedded: boolean;
  databaseUrlConfigured: boolean;
  persistencePath?: string;
}

/**
 * Detects whether the current Node process is executing a test script or test runner.
 * Used to isolate test databases strictly to in-memory PGlite instances so they never
 * clash with or lock the running development server's persistent storage.
 */
export function isTestExecution(): boolean {
  if (process.env.PG_MEM === 'true') return true;
  if (process.env.NODE_ENV === 'test') return true;
  if (process.env.DATA_DIR === 'memory') return true;
  if (
    process.argv &&
    process.argv.some(
      (arg) =>
        arg.includes('.test.') ||
        arg.includes('/tests/') ||
        arg.includes('test_') ||
        arg.includes('vitest') ||
        arg.includes('jest')
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Inspects environment variables to determine active database mode.
 * Priority:
 * 1. DATABASE_URL present and non-empty -> EXTERNAL_POSTGRES
 * 2. SQL_HOST present and non-empty -> CLOUD_SQL
 * 3. Default (DATABASE_URL absent) -> EMBEDDED_PGLITE (zero-configuration embedded PostgreSQL for dev/test)
 */
export function getActiveDatabaseMode(): ActiveDatabaseInfo {
  const isProduction = process.env.NODE_ENV === 'production';
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const sqlHost = process.env.SQL_HOST?.trim();

  if (databaseUrl && databaseUrl.length > 0) {
    return {
      mode: 'EXTERNAL_POSTGRES',
      engine: 'PostgreSQL (Network Pool)',
      isEmbedded: false,
      databaseUrlConfigured: true,
    };
  }

  if (sqlHost && sqlHost.length > 0) {
    return {
      mode: 'CLOUD_SQL',
      engine: 'PostgreSQL (Cloud SQL Pool)',
      isEmbedded: false,
      databaseUrlConfigured: false,
    };
  }

  // Production security & integrity requirement:
  // When NODE_ENV=production, external PostgreSQL is strictly mandatory.
  // Silently falling back to PGlite in production is forbidden.
  if (isProduction && !isTestExecution()) {
    throw new Error(
      'CRITICAL CONFIGURATION ERROR: DATABASE_URL is mandatory in production (NODE_ENV=production). Embedded PGlite fallback is disabled in production.'
    );
  }

  const isTest = isTestExecution();
  return {
    mode: 'EMBEDDED_PGLITE',
    engine: isTest ? 'PostgreSQL (In-Memory Engine)' : 'PostgreSQL (Embedded Engine)',
    isEmbedded: true,
    databaseUrlConfigured: false,
    persistencePath: isTest ? undefined : path.join(process.cwd(), 'data', 'postgres'),
  };
}

/**
 * Resolves the active database engine.
 * Priority:
 * 1. DATABASE_URL (Standard PostgreSQL connection string)
 * 2. SQL_HOST (Cloud SQL / Private IP environment)
 * 3. Local Embedded PostgreSQL (PGlite) with persistence in ./data/postgres (DEFAULT)
 */
export function getOrCreateDatabase() {
  if (global._bugripDrizzleDb) {
    return global._bugripDrizzleDb;
  }

  const dbInfo = getActiveDatabaseMode();

  if (dbInfo.mode === 'EXTERNAL_POSTGRES') {
    const databaseUrl = process.env.DATABASE_URL!.trim();
    if (!global._bugripPgPool) {
      global._bugripPgPool = new Pool({
        connectionString: databaseUrl,
        max: 10,
        connectionTimeoutMillis: 10000,
      });

      global._bugripPgPool.on('error', (err) => {
        console.error('Unexpected error on idle PostgreSQL pool client:', err);
      });
    }

    const db = drizzlePg(global._bugripPgPool, { schema });
    global._bugripDrizzleDb = db;
    return db;
  }

  if (dbInfo.mode === 'CLOUD_SQL') {
    const sqlHost = process.env.SQL_HOST!.trim();
    if (!global._bugripPgPool) {
      global._bugripPgPool = new Pool({
        host: sqlHost,
        user: process.env.SQL_USER,
        password: process.env.SQL_PASSWORD,
        database: process.env.SQL_DB_NAME,
        max: 10,
        connectionTimeoutMillis: 10000,
      });

      global._bugripPgPool.on('error', (err) => {
        console.error('Unexpected error on idle Cloud SQL pool client:', err);
      });
    }

    const db = drizzlePg(global._bugripPgPool, { schema });
    global._bugripDrizzleDb = db;
    return db;
  }

  // Default: Embedded PostgreSQL (PGlite) - Zero external configuration required
  if (!global._bugripPglite) {
    const isTest = isTestExecution();
    const customDir = process.env.DATA_DIR?.trim();
    if (isTest || process.env.PG_MEM === 'true' || customDir === 'memory') {
      global._bugripPglite = new PGlite();
    } else {
      const dataDir = customDir || dbInfo.persistencePath || path.join(process.cwd(), 'data', 'postgres');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      } else {
        // Clean up any stale postmaster.pid left from killed processes
        const pidFile = path.join(dataDir, 'postmaster.pid');
        if (fs.existsSync(pidFile)) {
          try {
            fs.unlinkSync(pidFile);
          } catch {}
        }
      }
      try {
        global._bugripPglite = new PGlite(dataDir);
      } catch (err) {
        console.warn('PGlite dataDir initialization warning, recreating clean storage:', err);
        try {
          fs.rmSync(dataDir, { recursive: true, force: true });
          fs.mkdirSync(dataDir, { recursive: true });
          global._bugripPglite = new PGlite(dataDir);
        } catch {
          global._bugripPglite = new PGlite();
        }
      }
    }
  }

  const drizzleInstance = drizzlePglite(global._bugripPglite, { schema });
  global._bugripDrizzleDb = drizzleInstance;
  return drizzleInstance;
}

/**
 * Reset and clear active database instances (used after crashes, aborts, or testing)
 */
export function resetDatabaseInstance(): void {
  try {
    if (global._bugripPglite) {
      global._bugripPglite.close().catch(() => {});
    }
  } catch {}
  global._bugripPglite = undefined;
  global._bugripDrizzleDb = undefined;
}

/**
 * Lazy database proxy: only initializes connection when a query or property is accessed.
 * Prevents unnecessary locks when importing models, schemas, or helper functions.
 * Self-heals if the underlying WASM engine experienced an unrecoverable abort.
 */
export const db: any = new Proxy(
  {},
  {
    get(_target, prop) {
      const instance = getOrCreateDatabase();
      const val = (instance as any)[prop];
      if (typeof val === 'function') {
        return val.bind(instance);
      }
      return val;
    },
  }
);

/**
 * Gracefully close database connection pools or embedded instances
 */
export async function closeDatabase(): Promise<void> {
  if (global._bugripPgPool) {
    try {
      await global._bugripPgPool.end();
    } catch {}
    global._bugripPgPool = undefined;
  }
  if (global._bugripPglite) {
    try {
      await Promise.race([
        global._bugripPglite.close(),
        new Promise((resolve) => setTimeout(resolve, 500)),
      ]);
    } catch {}
    global._bugripPglite = undefined;
  }
  global._bugripDrizzleDb = undefined;
}

/**
 * Safe database health check
 * Returns active engine, connection status, latency, and mode without leaking secrets.
 */
export async function checkDatabaseHealth(): Promise<{
  connected: boolean;
  mode: DatabaseMode;
  engine: string;
  isEmbedded: boolean;
  databaseUrlConfigured: boolean;
  latencyMs?: number;
  error?: string;
}> {
  const start = Date.now();
  let dbInfo: ActiveDatabaseInfo;
  try {
    dbInfo = getActiveDatabaseMode();
  } catch (err: any) {
    return {
      connected: false,
      mode: 'EXTERNAL_POSTGRES',
      engine: 'PostgreSQL (Unconfigured)',
      isEmbedded: false,
      databaseUrlConfigured: false,
      error: err?.message || 'Database configuration error',
    };
  }

  try {
    // 1. External PostgreSQL / Cloud SQL handling
    if (dbInfo.mode === 'EXTERNAL_POSTGRES' || dbInfo.mode === 'CLOUD_SQL') {
      getOrCreateDatabase();
      if (!global._bugripPgPool) {
        throw new Error('PostgreSQL connection pool failed to initialize.');
      }
      const client = await global._bugripPgPool.connect();
      try {
        await client.query('SELECT 1 as health_check;');
        return {
          connected: true,
          mode: dbInfo.mode,
          engine: dbInfo.engine,
          isEmbedded: dbInfo.isEmbedded,
          databaseUrlConfigured: dbInfo.databaseUrlConfigured,
          latencyMs: Date.now() - start,
        };
      } finally {
        client.release();
      }
    }

    // 2. Embedded PGlite handling (Development and test environments only)
    if (global._bugripPglite) {
      try {
        await global._bugripPglite.query('SELECT 1 as health_check;');
        return {
          connected: true,
          mode: dbInfo.mode,
          engine: dbInfo.engine,
          isEmbedded: dbInfo.isEmbedded,
          databaseUrlConfigured: dbInfo.databaseUrlConfigured,
          latencyMs: Date.now() - start,
        };
      } catch (pgliteQueryErr: any) {
        console.warn('PGlite health query failed, attempting self-healing reinitialization:', pgliteQueryErr?.message);
        try {
          await global._bugripPglite.close();
        } catch {}
        global._bugripPglite = undefined;
        global._bugripDrizzleDb = undefined;

        const dataDir = process.env.DATA_DIR?.trim() || dbInfo.persistencePath || path.join(process.cwd(), 'data', 'postgres');
        const isTest = isTestExecution();

        // Soft recovery: clean stale postmaster.pid
        if (!isTest && dataDir && dataDir !== 'memory' && fs.existsSync(dataDir)) {
          const pid = path.join(dataDir, 'postmaster.pid');
          if (fs.existsSync(pid)) {
            try { fs.unlinkSync(pid); } catch {}
          }
        }

        let softRecovered = false;
        try {
          getOrCreateDatabase();
          if (global._bugripPglite) {
            await global._bugripPglite.query('SELECT 1 as health_check;');
            softRecovered = true;
            return {
              connected: true,
              mode: dbInfo.mode,
              engine: dbInfo.engine,
              isEmbedded: dbInfo.isEmbedded,
              databaseUrlConfigured: dbInfo.databaseUrlConfigured,
              latencyMs: Date.now() - start,
            };
          }
        } catch (softErr: any) {
          console.warn('Soft recovery failed, storage corrupted:', softErr?.message);
        }

        // Deep recovery in development only
        if (!softRecovered && !isTest && dataDir && dataDir !== 'memory') {
          try {
            await global._bugripPglite?.close();
          } catch {}
          global._bugripPglite = undefined;
          global._bugripDrizzleDb = undefined;

          if (fs.existsSync(dataDir)) {
            try {
              fs.rmSync(dataDir, { recursive: true, force: true });
              fs.mkdirSync(dataDir, { recursive: true });
            } catch (fsErr) {
              console.error('Failed to recreate storage directory:', fsErr);
            }
          }

          getOrCreateDatabase();
          if (global._bugripPglite) {
            try {
              const { runMigrations } = await import('../../database/migrator.ts');
              const { runSeed } = await import('../../database/seed.ts');
              await runMigrations();
              await runSeed({ includeDemoParticipants: false });
            } catch (migErr) {
              console.error('Failed to apply migrations during deep recovery:', migErr);
            }

            await global._bugripPglite.query('SELECT 1 as health_check;');
            return {
              connected: true,
              mode: dbInfo.mode,
              engine: dbInfo.engine,
              isEmbedded: dbInfo.isEmbedded,
              databaseUrlConfigured: dbInfo.databaseUrlConfigured,
              latencyMs: Date.now() - start,
            };
          }
        }
      }
    }

    // Default initialization for development PGlite
    getOrCreateDatabase();
    if (global._bugripPglite) {
      await global._bugripPglite.query('SELECT 1 as health_check;');
      return {
        connected: true,
        mode: dbInfo.mode,
        engine: dbInfo.engine,
        isEmbedded: dbInfo.isEmbedded,
        databaseUrlConfigured: dbInfo.databaseUrlConfigured,
        latencyMs: Date.now() - start,
      };
    }

    return {
      connected: true,
      mode: dbInfo.mode,
      engine: dbInfo.engine,
      isEmbedded: dbInfo.isEmbedded,
      databaseUrlConfigured: dbInfo.databaseUrlConfigured,
      latencyMs: Date.now() - start,
    };
  } catch (err: any) {
    console.error('checkDatabaseHealth error:', err?.message || err);
    return {
      connected: false,
      mode: dbInfo.mode,
      engine: dbInfo.engine,
      isEmbedded: dbInfo.isEmbedded,
      databaseUrlConfigured: dbInfo.databaseUrlConfigured,
      error: err?.message || 'Unknown database error',
    };
  }
}

/**
 * Execute raw SQL query safely across drivers
 */
export async function executeRawSql(sql: string, params: any[] = []): Promise<any> {
  const dbInfo = getActiveDatabaseMode();
  getOrCreateDatabase();

  try {
    if (dbInfo.mode === 'EXTERNAL_POSTGRES' || dbInfo.mode === 'CLOUD_SQL') {
      if (!global._bugripPgPool) {
        throw new Error('PostgreSQL connection pool not initialized.');
      }
      const res = await global._bugripPgPool.query(sql, params);
      return res.rows;
    }

    if (global._bugripPglite) {
      if (params.length === 0) {
        const trimmed = sql.trim();
        const isSelect = trimmed.startsWith('SELECT') || trimmed.startsWith('select');
        if (isSelect) {
          const res = await global._bugripPglite.query(sql);
          return res.rows;
        } else {
          const res = await global._bugripPglite.exec(sql);
          return res?.[0]?.rows || [];
        }
      } else {
        const res = await global._bugripPglite.query(sql, params);
        return res.rows;
      }
    }

    throw new Error('No active database engine available for SQL execution.');
  } catch (error: any) {
    console.error('SQL execution failed:', error?.message || error);
    throw new Error(`Database query execution error: ${error?.message || error}`, { cause: error });
  }
}

export { schema };

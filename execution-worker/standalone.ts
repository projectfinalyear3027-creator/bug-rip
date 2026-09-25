/**
 * BUG SNIPER - Dedicated Production Java Execution Worker Entrypoint
 * 
 * Standalone background worker process that:
 * 1. Verifies PostgreSQL and Redis connectivity
 * 2. Runs OpenJDK 21 and Linux isolation preflight checks
 * 3. Consumes Java execution jobs from Redis/BullMQ queue
 * 4. Runs submissions under unprivileged sandbox user with unshare isolation
 * 5. Records results to PostgreSQL database
 */

import { executionWorker } from './worker.ts';
import { checkDatabaseHealth } from '../src/db/index.ts';
import { verifyExecutionEnvironmentOrThrow, resolveJdkEnvironment } from './jdkEnvironment.ts';
import { executionQueue } from './queue.ts';

async function startStandaloneWorker() {
  const isProduction = process.env.NODE_ENV === 'production';
  const workerPid = process.pid;

  console.log('================================================================');
  console.log(`BUG SNIPER: Standalone Execution Worker Daemon (PID: ${workerPid})`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('================================================================');

  // 1. Verify Database Connectivity
  console.log('[Worker] Verifying database connection...');
  const dbHealth = await checkDatabaseHealth();
  if (!dbHealth.connected) {
    console.error(`[Worker] Database connection failed: ${dbHealth.error || 'Unknown error'}`);
    if (isProduction) {
      console.error('[Worker] FATAL: Cannot start standalone worker without database connectivity.');
      process.exit(1);
    }
  } else {
    console.log(`[Worker] Database connected successfully (${dbHealth.engine}, mode: ${dbHealth.mode})`);
  }

  // 2. Mandatory Linux Sandbox & OpenJDK 21 Preflight Checks
  console.log('[Worker] Performing OpenJDK 21 and Linux Sandbox Preflight...');
  try {
    verifyExecutionEnvironmentOrThrow();
  } catch (preflightErr: any) {
    console.error('[Worker] CRITICAL PREFLIGHT FAILURE:', preflightErr.message);
    process.exit(1);
  }

  const jdkInfo = resolveJdkEnvironment();
  const sandboxUserLabel = `${jdkInfo.sandboxConfig?.user || 'sandbox'} (UID ${jdkInfo.sandboxConfig?.uid || 2001}:GID ${jdkInfo.sandboxConfig?.gid || 2001})`;
  console.log(`[Worker] Verified OpenJDK 21: ${jdkInfo.javacVersion}`);
  console.log(`[Worker] Sandbox User ${sandboxUserLabel}: ${jdkInfo.sandboxUserExists ? 'READY' : 'NOT FOUND'}`);
  console.log(`[Worker] Linux Namespace Isolation (unshare): ${jdkInfo.isolationAvailable ? 'ACTIVE' : 'INACTIVE'}`);

  // 3. Start Execution Worker Service
  try {
    await executionWorker.start();
    console.log(`[Worker] Ready and polling for jobs from Redis queue: ${executionQueue.getMode()}`);
  } catch (startErr: any) {
    console.error('[Worker] FATAL: Failed to start execution worker:', startErr.message);
    process.exit(1);
  }

  // 4. Graceful Shutdown Handlers
  const shutdown = async (signal: string) => {
    console.log(`\n[Worker] Received ${signal}. Shutting down worker gracefully...`);
    try {
      await executionWorker.stop();
      console.log('[Worker] Graceful shutdown complete.');
      process.exit(0);
    } catch (err) {
      console.error('[Worker] Error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startStandaloneWorker().catch((fatalErr) => {
  console.error('[Worker] Unexpected top-level error in worker daemon:', fatalErr);
  process.exit(1);
});

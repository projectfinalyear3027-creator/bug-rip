import express from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import { createServer as createViteServer } from 'vite';
import { healthRouter, handleReadinessProbe, setServerReady } from './backend/routes/health.ts';
import { authRouter } from './backend/routes/authRoutes.ts';
import { teamRouter } from './backend/routes/teamRoutes.ts';
import { leaderboardRouter } from './backend/routes/leaderboardRoutes.ts';
import { adminRouter } from './backend/routes/adminRoutes.ts';
import { challengeRouter, handleRunExecution } from './backend/routes/challengeRoutes.ts';
import { antiCheatRouter } from './backend/routes/antiCheatRoutes.ts';
import { requireParticipantAuth } from './backend/middleware/authMiddleware.ts';
import { errorHandler } from './backend/middleware/errorHandler.ts';
import { runMigrations } from './database/migrator.ts';
import { runSeed } from './database/seed.ts';
import { checkDatabaseHealth } from './src/db/index.ts';
import { teamRepository } from './backend/repositories/teamRepository.ts';
import { eventService } from './backend/services/eventService.ts';
import { executionWorker } from './execution-worker/worker.ts';
import { executionQueue } from './execution-worker/queue.ts';
import { executionRateLimiter } from './backend/middleware/rateLimiter.ts';

async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';
  const PORT = parseInt(process.env.PORT || '3000', 10);

  console.log('----------------------------------------------------');
  console.log(`BUG SNIPER: Starting Server [NODE_ENV=${process.env.NODE_ENV || 'development'}]`);
  console.log('----------------------------------------------------');

  // Production Readiness & Dependency Verification Sequence
  try {
    // 0. Production Secret Preflight Validation
    if (isProduction) {
      const adminSecret = process.env.ADMIN_SECRET_KEY?.trim();
      if (!adminSecret) {
        throw new Error('CRITICAL CONFIGURATION ERROR: ADMIN_SECRET_KEY is mandatory in production.');
      }
      if (
        adminSecret === 'bugrip-superadmin-secret-2026' ||
        adminSecret === 'admin' ||
        adminSecret === 'secret' ||
        adminSecret === 'changeme' ||
        adminSecret === 'password' ||
        adminSecret === '1234567890123456' ||
        adminSecret.length < 16
      ) {
        throw new Error('CRITICAL SECURITY ERROR: ADMIN_SECRET_KEY in production must be a secure, non-default string of at least 16 characters.');
      }
    }

    // 1. Verify Database Connection
    console.log('[Bootstrap 1/4] Verifying database connection...');
    const health = await checkDatabaseHealth();
    if (!health.connected) {
      throw new Error(`Database connection failed: ${health.error || 'Unable to connect to database'}`);
    }
    console.log(`✓ Active Database: ${health.engine} [Mode: ${health.mode}] (Configured: ${health.databaseUrlConfigured})`);

    // 2. Database Migrations (Idempotent Ledger)
    console.log('[Bootstrap 2/4] Executing database migrations...');
    await runMigrations();
    console.log('✓ Database migrations complete.');

    // 3. Database Configuration Seed (Solo Competition, 45 Challenges, 0 Demo Participants)
    console.log('[Bootstrap 3/4] Seeding core configuration (Solo rules & 45 challenges)...');
    await runSeed({ includeDemoParticipants: false });
    console.log('✓ Core configuration seed verified.');

    // Verify registration state
    const regCounts = await teamRepository.getRegistrationCounts();
    console.log(`✓ Current Participants: ${regCounts.participants} registered.`);

    // 4. Redis Queue & Java Execution Worker
    console.log('[Bootstrap 4/4] Starting Java Execution Worker & Queue...');
    const startInProcessWorker = process.env.START_IN_PROCESS_WORKER !== 'false';
    if (startInProcessWorker) {
      await executionWorker.start();
      console.log(`✓ Java Worker active in ${executionQueue.getMode()} mode.`);
    } else {
      console.log('[Web Server] Standalone web mode: In-process worker disabled (handled by bugsniper-worker service).');
      await executionQueue.initialize();
      console.log(`✓ Execution queue initialized in producer mode: ${executionQueue.getMode()}`);
    }

    // All production dependencies verified
    setServerReady(true);
    console.log('✓ Production readiness verified: Database, Migrations, Seed, Redis, and Worker are ONLINE.');

    // Background competition timer ticker
    setInterval(async () => {
      try {
        await eventService.getEventStatus();
      } catch {
        // Silently ignore
      }
    }, 3000);

  } catch (bootstrapErr: any) {
    console.error('====================================================');
    console.error('CRITICAL SERVER BOOTSTRAP FAILURE:');
    console.error(bootstrapErr?.message || bootstrapErr);
    if (bootstrapErr?.stack) {
      console.error(bootstrapErr.stack);
    }
    console.error('====================================================');

    if (isProduction) {
      console.error('FATAL: Aborting server startup in production due to dependency failure.');
      process.exit(1);
    } else {
      console.warn('WARNING: Continuing in degraded development mode...');
    }
  }

  const app = express();

  // Configure Express trust proxy for Nginx HTTPS reverse proxy
  app.set('trust proxy', 1);

  app.use(express.json());
  app.use(express.text({ type: ['text/*', 'application/x-www-form-urlencoded'] }));
  app.use(cookieParser());

  // Configure CORS
  const rawAllowedOrigins = [
    process.env.CORS_ORIGIN,
    process.env.APP_URL,
  ]
    .filter(Boolean)
    .flatMap((o) => o!.split(',').map((s) => s.trim().replace(/\/$/, '')));

  app.use((req, res, next) => {
    const origin = req.headers.origin;

    if (!isProduction) {
      // Development mode: support credentialed requests from preview containers and dev ports
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
      }
    } else {
      // Production mode: reject arbitrary origins; only allow explicitly configured origins
      if (origin && rawAllowedOrigins.includes(origin.replace(/\/$/, ''))) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
    }

    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS'
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cookie, X-Session-Token, X-Admin-Token, X-Admin-Key'
    );

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // Root-level and /api readiness probes
  app.get(['/ready', '/health/ready'], handleReadinessProbe);

  // Mount API routes BEFORE Vite middleware
  app.use('/api', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/teams', teamRouter);
  app.use('/api/team', teamRouter); // Alias for team API
  app.use('/api/challenges', challengeRouter);
  app.use('/api/anti-cheat', antiCheatRouter);
  app.use('/api/leaderboard', leaderboardRouter);
  app.use('/api/admin', adminRouter);

  // Execution API aliases to ensure all standard execution paths return JSON with participant auth & rate limiting
  app.post(
    [
      '/api/execution/run',
      '/api/execute',
      '/api/submissions/run',
      '/api/participant/execution/run',
      '/api/run',
    ],
    requireParticipantAuth,
    executionRateLimiter,
    handleRunExecution
  );

  // 404 handler for unknown API routes - strictly prevents falling through to Vite SPA index.html
  app.all(['/api', '/api/*'], (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.status(404).json({
      success: false,
      error: 'Not Found',
      message: `API route ${req.method} ${req.originalUrl || req.url} not found.`,
      endpoint: req.originalUrl || req.url,
    });
  });

  // Global API error handler
  app.use(errorHandler);

  // Vite middleware for development or static serving for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Start HTTP listener only after initial bootstrap sequence
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`====================================================`);
    console.log(`BUG SNIPER Server listening on http://0.0.0.0:${PORT}`);
    console.log(`Readiness: http://0.0.0.0:${PORT}/api/health/ready`);
    console.log(`====================================================`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start BUG SNIPER server:', err);
  process.exit(1);
});

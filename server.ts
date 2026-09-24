import express from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import { createServer as createViteServer } from 'vite';
import { healthRouter } from './backend/routes/health.ts';
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

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(express.text({ type: ['text/*', 'application/x-www-form-urlencoded'] }));
  app.use(cookieParser());

  // Enable CORS with support for credentials across preview environments and iframes
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS'
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cookie, X-Session-Token, X-Admin-Token'
    );

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // Mount API routes BEFORE Vite middleware
  app.use('/api', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/teams', teamRouter);
  app.use('/api/team', teamRouter); // Alias for team API
  app.use('/api/challenges', challengeRouter);
  app.use('/api/anti-cheat', antiCheatRouter);
  app.use('/api/leaderboard', leaderboardRouter);
  app.use('/api/admin', adminRouter);

  // Execution API aliases to ensure all standard execution paths return JSON with participant auth
  app.post(
    [
      '/api/execution/run',
      '/api/execute',
      '/api/submissions/run',
      '/api/participant/execution/run',
      '/api/run',
    ],
    requireParticipantAuth,
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

  // Start HTTP listener immediately so container ingress and control plane health checks pass promptly
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BUG SNIPER Server listening on http://0.0.0.0:${PORT}`);

    // Asynchronously bootstrap Database Migrations & Initial Seed
    (async () => {
      try {
        console.log('Initializing BUG SNIPER persistent PostgreSQL database...');
        await runMigrations();
        // Core seed only: zero demo participants in production/clean startup
        await runSeed({ includeDemoParticipants: false });
        const health = await checkDatabaseHealth();
        console.log(`✓ Active Database: ${health.engine} [Mode: ${health.mode}] (DATABASE_URL configured: ${health.databaseUrlConfigured})`);

        // Safe registration verification
        const regCounts = await teamRepository.getRegistrationCounts();
        console.log(`✓ Registration State: ${regCounts.teams} teams, ${regCounts.participants} participants, ${regCounts.teamMembers} memberships`);
        if (regCounts.teams === 0) {
          console.log('✓ Clean deployment verified: 0 registered participant teams. Ready for symposium CSV import.');
        } else {
          console.log(`ℹ Notice: Database contains ${regCounts.teams} registered team(s).`);
        }

        // Start Java execution worker for untrusted code execution after DB is verified
        executionWorker.start().catch((err) => {
          console.error('[ExecutionWorker] Startup warning:', err);
        });

        // Authoritative background competition timer ticker (starts only after DB is ready)
        setInterval(async () => {
          try {
            await eventService.getEventStatus();
          } catch {
            // Silently ignore
          }
        }, 3000);
      } catch (dbInitErr) {
        console.error('Warning: Database bootstrap encountered an issue:', dbInitErr);
      }
    })();
  });
}

startServer().catch((err) => {
  console.error('Failed to start BUG SNIPER server:', err);
  process.exit(1);
});

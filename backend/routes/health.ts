/**
 * BUG RIP - Health and Competition Rules API Endpoints
 * Provides system diagnostics and exposes immutable competition rules to frontends.
 */

import { Router, Request, Response } from 'express';
import { config } from '../config.ts';
import {
  COMPETITION_DURATION_MINUTES,
  COMPETITION_DURATION_SECONDS,
  INITIAL_DIFFICULTY_CONFIGS,
} from '../rules/competitionRules.ts';
import { EventState } from '../types/competition.ts';
import { checkDatabaseHealth } from '../../src/db/index.ts';
import { eventRepository } from '../repositories/eventRepository.ts';
import { teamRepository } from '../repositories/teamRepository.ts';
import { challengeRepository } from '../repositories/challengeRepository.ts';
import { adminRepository } from '../repositories/adminRepository.ts';
import { eventService } from '../services/eventService.ts';
import { resolveJdkEnvironment } from '../../execution-worker/jdkEnvironment.ts';
import { executionQueue } from '../../execution-worker/queue.ts';

export const healthRouter = Router();

// Startup timestamp for uptime calculation
const startTime = Date.now();

// Server readiness tracking for production probes
let isServerReady = false;

export function setServerReady(ready: boolean = true): void {
  isServerReady = ready;
}

export function getServerReady(): boolean {
  return isServerReady;
}

// Server-authoritative event state manager
let currentEventState: EventState = EventState.NOT_STARTED;
let competitionStartTime: number | null = null;
let pausedElapsedSeconds: number = 0;

export function getEventState(): EventState {
  return currentEventState;
}

export function setEventState(state: EventState, startTimeMs?: number): void {
  currentEventState = state;
  if (startTimeMs !== undefined) {
    competitionStartTime = startTimeMs;
  }
}

/**
 * Authoritative Readiness Probe Handler
 * Serves /ready, /health/ready, /api/ready, /api/health/ready
 * Distinguishes: initializing, ready, degraded, failed
 * Does not report READY while Java execution is unavailable.
 */
export async function handleReadinessProbe(_req: Request, res: Response) {
  const dbHealth = await checkDatabaseHealth();
  const jdkInfo = resolveJdkEnvironment();
  const isProd = process.env.NODE_ENV === 'production';
  const javaAvailable = Boolean(jdkInfo.isAvailable && (!isProd || jdkInfo.isJdk21));
  const queueHealth = await executionQueue.checkHealth();
  const queueAvailable = queueHealth.available && (!isProd || queueHealth.mode === 'redis');

  let status: 'ready' | 'initializing' | 'degraded' | 'failed';
  let httpStatus = 503;

  if (!dbHealth.connected) {
    status = 'failed';
  } else if (!isServerReady) {
    status = 'initializing';
  } else if (!javaAvailable || !queueAvailable) {
    status = 'degraded';
  } else {
    status = 'ready';
    httpStatus = 200;
  }

  const isReady = status === 'ready';

  return res.status(httpStatus).json({
    ready: isReady,
    status,
    services: {
      api: 'healthy',
      database: dbHealth.connected ? 'healthy' : 'failed',
      java: javaAvailable ? 'ready' : 'unavailable',
      queue: queueAvailable ? 'ready' : 'failed',
      worker: isServerReady && javaAvailable ? 'ready' : 'not_ready',
    },
    details: {
      databaseEngine: dbHealth.engine,
      databaseMode: dbHealth.mode,
      queueMode: queueHealth.mode,
      javaVersion: jdkInfo.javaVersion,
      isJdk21: jdkInfo.isJdk21,
    },
    ...(isReady
      ? {}
      : {
          error: !dbHealth.connected
            ? dbHealth.error || 'Database connection unavailable'
            : !javaAvailable
            ? 'Java execution sandbox is unavailable'
            : !queueAvailable
            ? 'Redis queue is unavailable in production'
            : 'Server is still initializing',
        }),
  });
}

/**
 * GET /api/ready
 * GET /api/health/ready
 * Kubernetes/VM readiness probe.
 */
healthRouter.get(['/ready', '/health/ready'], handleReadinessProbe);

/**
 * GET /api/health
 * Production health check for infrastructure monitors, container probes, and dev verification.
 * Verifies API server and real PostgreSQL database engine.
 */
healthRouter.get('/health', async (_req: Request, res: Response) => {
  const dbHealth = await checkDatabaseHealth();

  const isHealthy = dbHealth.connected;
  const statusCode = isHealthy ? 200 : 503;

  res.status(statusCode).json({
    status: isHealthy ? 'ok' : 'degraded',
    system: 'BUG SNIPER Java CTF Platform',
    version: '2.0.0-database-foundation',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    environment: config.server.nodeEnv,
    ready: isServerReady,
    services: {
      api: 'healthy',
      database: dbHealth.connected ? 'healthy' : 'unhealthy',
      readiness: isServerReady ? 'ready' : 'initializing',
      rulesEngine: 'healthy',
      configuration: 'loaded',
    },
    database: {
      connected: dbHealth.connected,
      mode: dbHealth.mode,
      engine: dbHealth.engine,
      isEmbedded: dbHealth.isEmbedded,
      databaseUrlConfigured: dbHealth.databaseUrlConfigured,
      latencyMs: dbHealth.latencyMs,
      error: dbHealth.error,
    },
  });
});

/**
 * GET /api/competition/health/db
 * Detailed diagnostic inspection of database entities and counts
 */
healthRouter.get('/competition/health/db', async (_req: Request, res: Response) => {
  try {
    const dbHealth = await checkDatabaseHealth();
    const [settings, regCounts, roundsList, challengesList] = await Promise.all([
      eventRepository.getEventSettings(),
      teamRepository.getRegistrationCounts(),
      challengeRepository.getRounds(),
      challengeRepository.getChallenges(),
    ]);

    res.json({
      databaseHealth: dbHealth,
      eventSettings: settings,
      entityCounts: {
        teams: regCounts.teams,
        participants: regCounts.participants,
        teamMembers: regCounts.teamMembers,
        rounds: roundsList.length,
        challenges: challengesList.length,
      },
      schema: {
        canonicalRanking: 'Problems Solved DESC -> Total Score DESC -> Earliest Solve Timestamp ASC',
        competitionFormat: 'Solo individual competition (1 participant unit)',
        secretCodeSource: 'CSV import only',
      },
    });
  } catch (err: any) {
    res.status(500).json({
      error: 'Failed to inspect database health details',
      message: err.message,
    });
  }
});

/**
 * GET /api/competition/health/registration-verification
 * Safe verification diagnostic for fresh deployment validation.
 * Verifies that registered teams = 0, participants = 0, and team memberships = 0 on fresh deployment.
 */
healthRouter.get('/competition/health/registration-verification', async (_req: Request, res: Response) => {
  try {
    const regCounts = await teamRepository.getRegistrationCounts();
    const isCleanFresh = regCounts.teams === 0 && regCounts.participants === 0 && regCounts.teamMembers === 0;

    res.json({
      status: 'ok',
      isCleanFresh,
      registeredTeams: regCounts.teams,
      registeredParticipants: regCounts.participants,
      registeredTeamMemberships: regCounts.teamMembers,
      readyForSymposiumImport: true,
      message: isCleanFresh
        ? 'Fresh database verified: 0 teams, 0 participants, 0 team memberships. Ready for Symposium CSV import.'
        : `Database contains ${regCounts.teams} registered team(s).`,
    });
  } catch (err: any) {
    res.status(500).json({
      status: 'error',
      error: 'Failed to execute registration verification',
      message: err.message,
    });
  }
});

/**
 * GET /api/competition/rules
 * Returns canonical immutable competition rules for client verification.
 */
healthRouter.get('/competition/rules', (_req: Request, res: Response) => {
  res.json({
    rules: {
      competitionName: 'BUG SNIPER - Java Debugging CTF',
      durationMinutes: COMPETITION_DURATION_MINUTES,
      durationSeconds: COMPETITION_DURATION_SECONDS,
      teamSize: {
        minMembers: config.competition.minTeamMembers,
        maxMembers: config.competition.maxTeamMembers,
        source: 'Pre-registered CSV only. No auto-generated codes.',
      },
      teamAsUnit: {
        sharedState: true,
        sharedScore: true,
        sharedProgress: true,
        simultaneousWorkAllowed: true,
      },
      rankingHierarchy: [
        { priority: 1, metric: 'Problems Solved', order: 'descending' },
        { priority: 2, metric: 'Total Score', order: 'descending' },
        { priority: 3, metric: 'Earliest Achievement Time', order: 'ascending (tiebreaker)' },
      ],
      submissionRacePolicy: 'First valid submission counts. Second concurrent submission by teammate is safely rejected without duplicate credit.',
      difficultyProgression: {
        levels: INITIAL_DIFFICULTY_CONFIGS.map((c) => c.displayName),
        mechanism: 'Unlock next tier via configured number of unique problem solves in current tier.',
        canReturnToEarlierTiers: true,
        adminOverrideAllowed: true,
      },
      executionPolicy: {
        attemptLimit: 'Unlimited runs',
        sandboxing: 'Isolated OpenJDK 21 process with strict CPU/memory/timeout limits',
        monacoEditor: true,
      },
      flagPrinciple: {
        revealMechanic: 'Corrected Java code execution reveals reconstructed flag in stdout.',
        fakeFlagProtection: 'Server verifies code execution behavior and output independently.',
      },
    },
  });
});

/**
 * GET /api/competition/config
 * Returns current difficulty tiers and unlock thresholds.
 */
healthRouter.get('/competition/config', (_req: Request, res: Response) => {
  res.json({
    difficulties: INITIAL_DIFFICULTY_CONFIGS,
    durationMinutes: config.competition.durationMinutes,
    teamSizeLimits: {
      min: config.competition.minTeamMembers,
      max: config.competition.maxTeamMembers,
    },
  });
});

/**
 * GET /api/event/status
 * GET /api/competition/status
 * Authoritative timer and event state backed by persistent database.
 */
const handleEventStatus = async (_req: Request, res: Response) => {
  try {
    const status = await eventService.getEventStatus();
    res.json({
      success: true,
      status: status.status,
      eventState: status.status, // backward compatibility
      eventName: status.eventName,
      durationMinutes: status.durationMinutes,
      totalSeconds: status.totalSeconds,
      remainingSeconds: status.remainingSeconds,
      elapsedSeconds: status.elapsedSeconds,
      startedAt: status.startedAt,
      endedAt: status.endedAt,
      pausedAt: status.pausedAt,
      scheduledEndTime: status.scheduledEndTime,
      serverTime: status.serverTime,
      isActionAllowed: status.isActionAllowed,
      isAuthoritative: true,
      currentMatchNumber: status.currentMatchNumber,
      currentMatchId: status.currentMatchId,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve authoritative event status.',
      message: err.message,
    });
  }
};

healthRouter.get('/competition/status', handleEventStatus);
healthRouter.get('/event/status', handleEventStatus);
healthRouter.get('/competition/event/status', handleEventStatus);

/**
 * POST /api/competition/event/status
 * POST /api/event/status
 * Simulation/Testing endpoint to quickly trigger event state transitions.
 */
healthRouter.post(['/competition/event/status', '/event/status'], async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    if (status === 'RUNNING' || status === 'PAUSED' || status === 'ENDED' || status === 'NOT_STARTED') {
      const result = await adminRepository.transitionEventStatus(
        status,
        '00000000-0000-0000-0000-000000000001',
        status
      );
      return res.json({ success: true, status, event: result.event });
    }
    return res.status(400).json({ success: false, error: 'Invalid status provided.' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});


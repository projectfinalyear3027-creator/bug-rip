/**
 * BUG RIP - Leaderboard API Routes
 * Serves canonical ranking based on:
 * 1. Problems Solved DESC
 * 2. Total Score DESC
 * 3. Earliest Solve Timestamp ASC
 */

import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { eventService } from '../services/eventService.ts';
import { leaderboardRealtimeService } from '../services/leaderboardRealtimeService.ts';
import { adminRepository } from '../repositories/adminRepository.ts';
import { teamRepository } from '../repositories/teamRepository.ts';
import { antiCheatRepository } from '../repositories/antiCheatRepository.ts';
import { extractToken, extractAdminToken } from '../middleware/authMiddleware.ts';

export const leaderboardRouter = Router();

/**
 * Checks if requester is an active participant in a currently RUNNING match.
 * Organizers/admins and public projectors (without participant sessions) are allowed.
 */
async function checkParticipantLeaderboardAccess(req: Request): Promise<{
  blocked: boolean;
  participantId?: string | null;
  teamId?: string | null;
  sessionId?: string | null;
}> {
  // If requester is an authenticated admin, never block!
  const adminToken = extractAdminToken(req);
  if (adminToken) {
    try {
      const adminSession = await adminRepository.validateAdminSession(adminToken);
      if (adminSession && adminSession.adminUser?.isActive) {
        return { blocked: false };
      }
    } catch {}
  }

  // Check if participant session token is present
  const participantToken = extractToken(req);
  if (!participantToken) {
    // Unauthenticated public auditorium display / projector
    return { blocked: false };
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(participantToken).digest('hex');
    const sessionData = await teamRepository.findSessionByTokenHash(tokenHash);
    if (!sessionData) {
      return { blocked: false };
    }

    const { team, session, participant } = sessionData as any;
    const participantStatus = participant?.status || team?.status || 'ACTIVE';
    if (participantStatus !== 'ACTIVE') {
      return { blocked: false };
    }

    const eventStatus = await eventService.getEventStatus();
    if (eventStatus.status === 'RUNNING') {
      return {
        blocked: true,
        participantId: participant?.id || team.id,
        teamId: team.id,
        sessionId: session?.id || null,
      };
    }
  } catch {}

  return { blocked: false };
}

/**
 * GET /api/leaderboard/matches
 * Returns list of all matches with summary status for match switcher.
 */
leaderboardRouter.get('/matches', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const matches = await adminRepository.getMatches();
    res.json({
      success: true,
      matches,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/leaderboard
 * Returns sanitized authoritative leaderboard rankings and event status.
 * Safe for public auditorium projector display (no team codes, no tokens, no flags).
 * Supports ?matchNumber=X to view historical or active match standings.
 */
leaderboardRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const accessCheck = await checkParticipantLeaderboardAccess(req);
    if (accessCheck.blocked) {
      const eventStatus = await eventService.getEventStatus();
      antiCheatRepository
        .recordEvent({
          participantId: accessCheck.participantId,
          teamId: accessCheck.teamId,
          participantSessionId: accessCheck.sessionId,
          eventType: 'ARENA_ROUTE_BLOCKED',
          actionTaken: 'RECORDED_VIOLATION',
          metadata: {
            attemptedRoute: req.originalUrl || '/api/leaderboard',
            reason: 'Active competitor attempted to access live scoreboard during running competition.',
            timestamp: Date.now(),
          },
          matchNumber: eventStatus.currentMatchNumber,
          matchId: eventStatus.currentMatchId,
        })
        .catch(() => {});

      return res.status(403).json({
        success: false,
        error: 'Access denied: Active competitors cannot view the live scoreboard while the match is running.',
        code: 'ARENA_LOCKED_SCOREBOARD_BLOCKED',
        redirectTo: '/arena',
      });
    }

    const eventStatus = await eventService.getEventStatus();
    const queryMatchNum = req.query.matchNumber ? parseInt(req.query.matchNumber as string, 10) : null;

    let leaderboard;
    let selectedMatchNumber = eventStatus.currentMatchNumber;
    let isArchivedMatch = false;

    if (queryMatchNum && !isNaN(queryMatchNum)) {
      selectedMatchNumber = queryMatchNum;
      const matchData = await adminRepository.getMatchLeaderboard(queryMatchNum);
      if (matchData) {
        leaderboard = matchData.leaderboard;
        isArchivedMatch = matchData.isArchived;
      } else {
        leaderboard = await eventService.getPublicLeaderboard({
          matchNumber: selectedMatchNumber,
          liveScoreOrdering: true,
          isArchived: false,
        });
      }
    } else {
      leaderboard = await eventService.getPublicLeaderboard({
        matchNumber: selectedMatchNumber,
        liveScoreOrdering: true,
        isArchived: false,
      });
    }

    const onlineCount = Array.isArray(leaderboard)
      ? leaderboard.filter((entry: any) => entry.isOnline).length
      : 0;

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      matchNumber: selectedMatchNumber,
      isArchivedMatch,
      onlineCount,
      totalParticipants: Array.isArray(leaderboard) ? leaderboard.length : 0,
      rankingCriteria: [
        '1. Problems Solved (DESC)',
        '2. Total Score (DESC)',
        '3. Earliest Solve Timestamp (ASC tiebreaker)',
      ],
      event: {
        status: eventStatus.status,
        durationMinutes: eventStatus.durationMinutes,
        totalSeconds: eventStatus.totalSeconds,
        remainingSeconds: eventStatus.remainingSeconds,
        elapsedSeconds: eventStatus.elapsedSeconds,
        startedAt: eventStatus.startedAt,
        pausedAt: eventStatus.pausedAt,
        endedAt: eventStatus.endedAt,
        serverTime: eventStatus.serverTime,
        currentMatchNumber: eventStatus.currentMatchNumber,
      },
      leaderboard,
      data: leaderboard,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/leaderboard/stream
 * Dedicated public read-only Server-Sent Events (SSE) stream for /live display.
 * COMPLETELY ISOLATED from private team streams.
 */
leaderboardRouter.get('/stream', async (req: Request, res: Response) => {
  const accessCheck = await checkParticipantLeaderboardAccess(req);
  if (accessCheck.blocked) {
    const eventStatus = await eventService.getEventStatus();
    antiCheatRepository
      .recordEvent({
        participantId: accessCheck.participantId,
        teamId: accessCheck.teamId,
        participantSessionId: accessCheck.sessionId,
        eventType: 'ARENA_ROUTE_BLOCKED',
        actionTaken: 'RECORDED_VIOLATION',
        metadata: {
          attemptedRoute: '/api/leaderboard/stream',
          reason: 'Active competitor attempted to connect to live scoreboard stream during running competition.',
          timestamp: Date.now(),
        },
        matchNumber: eventStatus.currentMatchNumber,
        matchId: eventStatus.currentMatchId,
      })
      .catch(() => {});

    return res.status(403).json({
      success: false,
      error: 'Access denied: Active competitors cannot view the live scoreboard stream while the match is running.',
      code: 'ARENA_LOCKED_SCOREBOARD_BLOCKED',
    });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // Send initial keep-alive comment
  res.write(': connected\n\n');

  // Register public client
  leaderboardRealtimeService.registerClient(res);

  // Send initial snapshot
  try {
    const eventStatus = await eventService.getEventStatus();
    const publicLeaderboard = await eventService.getPublicLeaderboard({
      matchNumber: eventStatus.currentMatchNumber,
      liveScoreOrdering: true,
    });
    const onlineCount = Array.isArray(publicLeaderboard)
      ? publicLeaderboard.filter((entry: any) => entry.isOnline).length
      : 0;

    const initialPayload = {
      timestamp: new Date().toISOString(),
      matchNumber: eventStatus.currentMatchNumber,
      onlineCount,
      totalParticipants: Array.isArray(publicLeaderboard) ? publicLeaderboard.length : 0,
      event: {
        status: eventStatus.status,
        durationMinutes: eventStatus.durationMinutes,
        totalSeconds: eventStatus.totalSeconds,
        remainingSeconds: eventStatus.remainingSeconds,
        elapsedSeconds: eventStatus.elapsedSeconds,
        startedAt: eventStatus.startedAt,
        pausedAt: eventStatus.pausedAt,
        endedAt: eventStatus.endedAt,
        serverTime: eventStatus.serverTime,
        currentMatchNumber: eventStatus.currentMatchNumber,
      },
      leaderboard: publicLeaderboard,
    };

    res.write(`event: leaderboard.init\ndata: ${JSON.stringify(initialPayload)}\n\n`);
  } catch (err) {
    console.error('[LeaderboardStream] Failed to send initial payload:', err);
  }
});

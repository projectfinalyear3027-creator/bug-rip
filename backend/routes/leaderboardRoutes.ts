/**
 * BUG RIP - Leaderboard API Routes
 * Serves canonical ranking based on:
 * 1. Problems Solved DESC
 * 2. Total Score DESC
 * 3. Earliest Solve Timestamp ASC
 */

import { Router, Request, Response, NextFunction } from 'express';
import { eventService } from '../services/eventService.ts';
import { leaderboardRealtimeService } from '../services/leaderboardRealtimeService.ts';
import { adminRepository } from '../repositories/adminRepository.ts';

export const leaderboardRouter = Router();

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
        leaderboard = await eventService.getPublicLeaderboard();
      }
    } else {
      leaderboard = await eventService.getPublicLeaderboard();
    }

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      matchNumber: selectedMatchNumber,
      isArchivedMatch,
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
leaderboardRouter.get('/stream', async (_req: Request, res: Response) => {
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
    const publicLeaderboard = await eventService.getPublicLeaderboard();
    const eventStatus = await eventService.getEventStatus();

    const initialPayload = {
      timestamp: new Date().toISOString(),
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
      },
      leaderboard: publicLeaderboard,
    };

    res.write(`event: leaderboard.init\ndata: ${JSON.stringify(initialPayload)}\n\n`);
  } catch (err) {
    console.error('[LeaderboardStream] Failed to send initial payload:', err);
  }
});

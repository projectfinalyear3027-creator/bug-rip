/**
 * BUG RIP - Team API Routes
 * Handles participant team verification and shared team state queries.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { teamService } from '../services/teamService.ts';
import { eventService } from '../services/eventService.ts';
import { teamLoginSchema } from '../validation/schemas.ts';
import { requireParticipantAuth, extractToken } from '../middleware/authMiddleware.ts';
import { teamRepository } from '../repositories/teamRepository.ts';
import { teamRealtimeService } from '../services/teamRealtimeService.ts';
import crypto from 'crypto';

export const teamRouter = Router();

/**
 * GET /api/teams/me
 * Returns authenticated team's details derived strictly from the server session
 */
teamRouter.get('/me', requireParticipantAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const teamId = req.team!.id;
    const details = await teamService.getTeamDetails(teamId);
    res.json({
      success: true,
      data: details,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/teams/me/challenges
 * Returns unlocked challenges for the authenticated team
 */
teamRouter.get('/me/challenges', requireParticipantAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const teamId = req.team!.id;
    const progress = await eventService.getTeamAvailableChallenges(teamId);
    res.json({
      success: true,
      data: progress,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/teams/me/progress or /api/team/progress
 * Returns difficulty progression breakdown for the authenticated team
 */
teamRouter.get('/me/progress', requireParticipantAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const teamId = req.team!.id;
    const progress = await eventService.getTeamAvailableChallenges(teamId);
    res.json({
      success: true,
      data: progress,
    });
  } catch (err) {
    next(err);
  }
});

// Alias for /api/team/progress and /api/team/challenges
teamRouter.get('/progress', requireParticipantAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const teamId = req.team!.id;
    const progress = await eventService.getTeamAvailableChallenges(teamId);
    res.json({
      success: true,
      data: progress,
    });
  } catch (err) {
    next(err);
  }
});

teamRouter.get('/challenges', requireParticipantAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const teamId = req.team!.id;
    const progress = await eventService.getTeamAvailableChallenges(teamId);
    res.json({
      success: true,
      data: progress,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/teams/login
 * Verifies team name and CSV secret code.
 * Enforces 1-3 member concurrent session limits.
 */
teamRouter.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = teamLoginSchema.parse(req.body);
    const userAgent = req.headers['user-agent'];
    const ipAddress = (req.ip || req.socket.remoteAddress || '').toString();

    const result = await teamService.authenticateTeam(
      validated.teamName,
      validated.teamCode,
      userAgent,
      ipAddress
    );

    res.json({
      success: true,
      message: 'Team credentials verified successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * GET /api/teams/stream or /api/team/stream
 * Server-Sent Events (SSE) stream for team realtime synchronization.
 * Strictly scoped to the authenticated participant's team (derived from session).
 * MUST be declared before /:id to prevent route shadowing.
 */
teamRouter.get('/stream', requireParticipantAuth, async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const teamId = req.team!.id;
  const sessionId = req.sessionRecord!.id;
  const participantId = req.sessionRecord!.participantId || undefined;

  const conn = await teamRealtimeService.registerClient({
    req,
    res,
    sessionId,
    teamId,
    participantId,
  });

  // Send initial state snapshot
  try {
    const progress = await eventService.getTeamAvailableChallenges(teamId);
    const activeSessions = await teamRepository.getActiveSessionCount(teamId);
    const team = await teamRepository.getTeamById(teamId);

    res.write(`event: team.init\ndata: ${JSON.stringify({
      teamId,
      teamName: req.team!.teamName,
      connectedMemberCount: activeSessions,
      registeredMemberCount: team?.registeredMemberCount ?? 2,
      progression: progress,
      timestamp: new Date().toISOString(),
    })}\n\n`);
  } catch (err) {
    console.error('Error sending initial team stream state:', err);
  }

  req.on('close', () => {
    teamRealtimeService.unregisterClient(conn.id);
  });
});

/**
 * GET /api/teams/:id
 * Returns team profile, members, and connected session counts.
 */
teamRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const teamId = req.params.id;
    if (!UUID_REGEX.test(teamId)) {
      return res.status(404).json({
        success: false,
        error: 'Team not found (invalid identifier format).',
      });
    }
    const details = await teamService.getTeamDetails(teamId);
    res.json({
      success: true,
      data: details,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/teams/:id/challenges
 * Returns unlocked and completed challenges for the team.
 * Enforces team isolation: if request is authenticated as Team A, Team B's challenges are forbidden.
 */
teamRouter.get('/:id/challenges', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const teamId = req.params.id;
    if (!UUID_REGEX.test(teamId)) {
      return res.status(404).json({
        success: false,
        error: 'Team not found (invalid identifier format).',
      });
    }

    // Team isolation check if session token is present
    const rawToken = extractToken(req);
    if (rawToken) {
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const sessionData = await teamRepository.findSessionByTokenHash(tokenHash);
      if (sessionData && sessionData.team.id !== teamId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: You cannot view challenge data for another team.',
          code: 'FORBIDDEN_TEAM_ISOLATION',
        });
      }
    }

    const progress = await eventService.getTeamAvailableChallenges(teamId);
    res.json({
      success: true,
      data: progress,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/teams/:id/members
 * Add a member to the team (up to 3 members allowed; 4th member rejected).
 */
teamRouter.post('/:id/members', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const teamId = req.params.id;
    const { name, email, phone, college, externalParticipantId } = req.body || {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Participant name is required.',
        code: 'INVALID_NAME',
      });
    }

    const result = await teamService.addMember(teamId, {
      name,
      email,
      phone,
      college,
      externalParticipantId,
    });

    res.status(201).json({
      success: true,
      data: result,
      message: 'Participant added successfully to team.',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/teams/:id/members/:participantId
 * Remove a member from the team (down to 1 member minimum).
 */
teamRouter.delete('/:id/members/:participantId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: teamId, participantId } = req.params;
    const result = await teamService.removeMember(teamId, participantId);

    res.json({
      success: true,
      data: result,
      message: 'Participant removed successfully from team.',
    });
  } catch (err) {
    next(err);
  }
});

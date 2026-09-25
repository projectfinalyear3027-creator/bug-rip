/**
 * BUG RIP - Participant Authentication & Session Management Routes
 * Implements:
 * 1. POST /api/auth/login (Primary solo competitor login)
 * 2. POST /api/auth/team-login (Backward-compatible alias)
 * 3. GET  /api/auth/session (Session restoration on browser reload)
 * 4. POST /api/auth/heartbeat (Keep-alive & stale session recovery)
 * 5. POST /api/auth/logout (Session termination)
 * 6. GET  /api/auth/events (SSE real-time start transition stream)
 */

import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { teamRepository } from '../repositories/teamRepository.ts';
import { eventRepository } from '../repositories/eventRepository.ts';
import { antiCheatRepository } from '../repositories/antiCheatRepository.ts';
import { teamRealtimeService } from '../services/teamRealtimeService.ts';
import { loginRateLimiter } from '../middleware/rateLimiter.ts';
import { requireParticipantAuth, extractToken } from '../middleware/authMiddleware.ts';

export const authRouter = Router();

/**
 * Common handler for participant login
 */
async function handleParticipantLogin(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body || {};
    const code = (body.participantCode || body.teamCode || body.code || '').toString().trim();
    const nameOrEmail = (body.participantName || body.teamName || body.name || body.email || '').toString().trim();

    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'PARTICIPANT ACCESS CODE REQUIRED',
        code: 'MISSING_CREDENTIALS',
      });
    }

    // 1. Verify participant credentials against PostgreSQL database
    let participant = await teamRepository.verifyParticipantCredentials(code, nameOrEmail || undefined);
    let legacyTeam: any = null;

    if (!participant && nameOrEmail) {
      // Fallback: verify against legacy team credentials
      legacyTeam = await teamRepository.verifyCredentials(nameOrEmail, code);
      if (legacyTeam) {
        const members = await teamRepository.getTeamParticipants(legacyTeam.id);
        if (members.length > 0) {
          participant = await teamRepository.findParticipantById(members[0].id);
        } else {
          participant = {
            id: legacyTeam.id,
            name: legacyTeam.teamName,
            participantCode: legacyTeam.teamCode,
            college: null,
            email: null,
            status: legacyTeam.status,
          } as any;
        }
      }
    }

    if (!participant) {
      return res.status(401).json({
        success: false,
        error: 'INVALID PARTICIPANT CREDENTIALS',
        code: 'INVALID_CREDENTIALS',
      });
    }

    // 2. Verify status
    if (participant.status === 'DISABLED' || participant.status === 'DISQUALIFIED' || participant.status === 'INACTIVE' || (participant.status && participant.status !== 'ACTIVE')) {
      return res.status(403).json({
        success: false,
        error: 'Participant registration is inactive.',
        code: 'PARTICIPANT_INACTIVE',
      });
    }

    // 3. Enforce Solo Session Limit: exactly 1 active session allowed per competitor
    const activeSessions = await teamRepository.getActiveParticipantSessionCount(participant.id);
    const userAgent = (req.headers['user-agent'] || '').slice(0, 500);
    const ipAddress = (req.ip || req.socket.remoteAddress || '').toString().slice(0, 45);

    if (activeSessions >= 1) {
      await eventRepository.recordAuditLog({
        action: 'MULTIPLE_SESSION_REJECTED',
        targetType: 'PARTICIPANT',
        targetId: participant.id,
        reason: 'Concurrent session limit exceeded for solo participant (maximum 1 active session allowed)',
        metadata: {
          participantId: participant.id,
          activeSessions,
          ipAddress,
        },
      });

      try {
        await antiCheatRepository.recordEvent({
          participantId: participant.id,
          teamId: legacyTeam?.id || undefined,
          eventType: 'MULTIPLE_SESSION',
          actionTaken: 'RECORDED_VIOLATION',
          metadata: {
            reason: 'Concurrent session limit exceeded (1 active session allowed)',
            participantId: participant.id,
            activeSessions,
            ipAddress,
            userAgent,
          },
        });
      } catch (acErr) {
        console.warn('Anti-cheat multi-session record error:', acErr);
      }

      return res.status(409).json({
        success: false,
        error: 'ACTIVE SESSION ALREADY RUNNING FOR THIS PARTICIPANT',
        code: 'SESSION_LIMIT_EXCEEDED',
      });
    }

    // 4. Generate secure cryptographic session token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const session = await teamRepository.createSession({
      teamId: legacyTeam?.id || undefined,
      participantId: participant.id,
      sessionTokenHash: tokenHash,
      userAgent,
      ipAddress,
    });

    // Record audit log
    await eventRepository.recordAuditLog({
      action: 'PARTICIPANT_SESSION_CONNECTED',
      targetType: 'SESSION',
      targetId: session.id,
      reason: 'Participant session successfully created and connected.',
      metadata: {
        participantId: participant.id,
        participantName: participant.name,
      },
    });

    // 5. Set secure HTTP-only cookie
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('bugrip_session', rawToken, {
      httpOnly: true,
      secure: isProduction || isHttps,
      sameSite: isProduction ? 'lax' : (isHttps ? 'none' : 'lax'),
      maxAge: 8 * 60 * 60 * 1000,
      path: '/',
    });

    // 6. Get authoritative event status
    const settings = await eventRepository.getEventSettings();
    const eventStatus = settings?.status || 'NOT_STARTED';

    return res.json({
      success: true,
      message: 'Participant authenticated successfully',
      isSolo: true,
      participant: {
        id: participant.id,
        name: participant.name,
        participantCode: participant.participantCode || code,
        college: participant.college || null,
        email: participant.email || null,
        status: participant.status || 'ACTIVE',
      },
      team: {
        id: participant.id,
        teamName: participant.name,
        registeredMemberCount: 1,
        connectedMemberCount: 1,
      },
      session: {
        id: session.id,
        connectedAt: session.connectedAt,
      },
      eventStatus,
      sessionToken: rawToken,
    });
  } catch (err) {
    console.error('Participant login error:', err);
    return res.status(500).json({
      success: false,
      error: 'UNABLE TO VERIFY CREDENTIALS. PLEASE TRY AGAIN.',
      code: 'SYSTEM_ERROR',
    });
  }
}

/**
 * POST /api/auth/login
 * Canonical solo competitor login endpoint
 */
authRouter.post('/login', loginRateLimiter, handleParticipantLogin);

/**
 * POST /api/auth/team-login
 * Backward-compatible alias
 */
authRouter.post('/team-login', loginRateLimiter, handleParticipantLogin);

/**
 * GET /api/auth/session
 * Restores authenticated participant state upon page reload.
 */
authRouter.get('/session', async (req: Request, res: Response) => {
  try {
    const rawToken = extractToken(req);
    if (!rawToken) {
      return res.status(401).json({
        authenticated: false,
        error: 'No active session found',
      });
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const sessionData = await teamRepository.findSessionByTokenHash(tokenHash);

    if (!sessionData) {
      res.clearCookie('bugrip_session', { path: '/' });
      return res.status(401).json({
        authenticated: false,
        error: 'Session invalid or expired',
      });
    }

    const { team, session, participant } = sessionData as any;

    const resolvedParticipant = participant || {
      id: team.id,
      name: team.teamName,
      participantCode: team.teamCode,
      college: null,
      email: null,
      status: team.status,
    };

    if (resolvedParticipant.status !== 'ACTIVE') {
      res.clearCookie('bugrip_session', { path: '/' });
      return res.status(403).json({
        authenticated: false,
        error: 'Participant registration is inactive.',
        code: 'PARTICIPANT_INACTIVE',
      });
    }

    // Refresh heartbeat
    await teamRepository.updateSessionHeartbeat(session.id);

    const settings = await eventRepository.getEventSettings();
    const eventStatus = settings?.status || 'NOT_STARTED';

    return res.json({
      authenticated: true,
      isSolo: true,
      participant: {
        id: resolvedParticipant.id,
        name: resolvedParticipant.name,
        participantCode: resolvedParticipant.participantCode || team.teamCode,
        college: resolvedParticipant.college || null,
        email: resolvedParticipant.email || null,
        status: resolvedParticipant.status || 'ACTIVE',
      },
      team: {
        id: resolvedParticipant.id,
        teamName: resolvedParticipant.name,
        registeredMemberCount: 1,
        connectedMemberCount: 1,
      },
      session: {
        id: session.id,
        connectedAt: session.connectedAt,
        lastHeartbeatAt: session.lastHeartbeatAt,
      },
      eventStatus,
      durationMinutes: settings?.durationMinutes || 60,
    });
  } catch (err) {
    console.error('Session restoration error:', err);
    return res.status(500).json({
      authenticated: false,
      error: 'UNABLE TO RESTORE SESSION. PLEASE TRY AGAIN.',
    });
  }
});

/**
 * POST /api/auth/heartbeat
 * Periodic pulse from participant browser to maintain active session & receive event status updates.
 */
authRouter.post('/heartbeat', requireParticipantAuth, async (req: Request, res: Response) => {
  try {
    const team = req.team!;
    const session = req.sessionRecord!;

    await teamRepository.updateSessionHeartbeat(session.id);
    const activeSessions = await teamRepository.getActiveSessionCount(team.id);
    const settings = await eventRepository.getEventSettings();

    return res.json({
      ok: true,
      eventStatus: settings?.status || 'NOT_STARTED',
      connectedMemberCount: activeSessions,
      registeredMemberCount: team.registeredMemberCount,
    });
  } catch (err) {
    console.error('Heartbeat update error:', err);
    return res.status(500).json({ ok: false });
  }
});

/**
 * POST /api/auth/logout
 * Terminates participant session cleanly and frees up the team connection slot immediately.
 */
authRouter.post('/logout', async (req: Request, res: Response) => {
  try {
    let rawToken = extractToken(req);
    if (!rawToken && req.body && typeof req.body.token === 'string') {
      rawToken = req.body.token;
    }
    if (!rawToken && typeof req.body === 'string') {
      try {
        const parsed = JSON.parse(req.body);
        if (typeof parsed.token === 'string') rawToken = parsed.token;
      } catch {}
    }
    if (rawToken) {
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const sessionData = await teamRepository.findSessionByTokenHash(tokenHash);
      if (sessionData) {
        await teamRepository.terminateSession(sessionData.session.id);
        await teamRealtimeService.unregisterSession(sessionData.session.id);

        await eventRepository.recordAuditLog({
          action: 'PARTICIPANT_SESSION_TERMINATED',
          targetType: 'SESSION',
          targetId: sessionData.session.id,
          reason: 'Participant voluntarily terminated session on logout.',
          metadata: { teamId: sessionData.team.id },
        });

        const activeSessions = teamRealtimeService.getConnectedMemberCount(sessionData.team.id);
        teamRealtimeService.notifyTeamMemberDisconnected(sessionData.team.id, {
          sessionId: sessionData.session.id,
          connectedCount: activeSessions,
          registeredCount: sessionData.team.registeredMemberCount,
          reason: 'LOGOUT',
        });
      }
    }
  } catch (err) {
    console.error('Error during logout session cleanup:', err);
  } finally {
    res.clearCookie('bugrip_session', { path: '/' });
    return res.json({
      success: true,
      message: 'Participant session terminated successfully',
    });
  }
});

/**
 * POST /api/auth/disconnect
 * Signals that participant browser tab was closed or unloaded (via sendBeacon / pagehide).
 * Immediately unregisters active realtime connection without destroying the session.
 */
authRouter.post('/disconnect', async (req: Request, res: Response) => {
  try {
    let rawToken = extractToken(req);
    if (!rawToken && req.body && typeof req.body.token === 'string') {
      rawToken = req.body.token;
    }
    if (!rawToken && typeof req.body === 'string') {
      try {
        const parsed = JSON.parse(req.body);
        if (typeof parsed.token === 'string') rawToken = parsed.token;
      } catch {}
    }
    if (rawToken) {
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const sessionData = await teamRepository.findSessionByTokenHash(tokenHash);
      if (sessionData) {
        await teamRealtimeService.unregisterSession(sessionData.session.id);
      }
    }
  } catch {
    // Non-blocking
  }
  return res.json({ ok: true });
});

/**
 * GET /api/auth/events
 * Real-time Server-Sent Events (SSE) stream for waiting room start transition.
 * Automatically broadcasts event state changes (e.g. NOT_STARTED -> RUNNING).
 */
authRouter.get('/events', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let registeredConnId: string | null = null;
  const rawToken = extractToken(req);
  if (rawToken) {
    try {
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const sessionData = await teamRepository.findSessionByTokenHash(tokenHash);
      if (sessionData) {
        const conn = await teamRealtimeService.registerClient({
          req,
          res,
          sessionId: sessionData.session.id,
          teamId: sessionData.team.id,
          participantId: sessionData.session.participantId || undefined,
        });
        registeredConnId = conn.id;
      }
    } catch {
      // Continue even if registration encounters transient issue
    }
  }

  // Send initial event
  const sendStatus = async () => {
    try {
      const settings = await eventRepository.getEventSettings();
      let connectedMemberCount = 1;
      let registeredMemberCount = 2;

      if (rawToken) {
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const sessionData = await teamRepository.findSessionByTokenHash(tokenHash);
        if (sessionData) {
          connectedMemberCount = await teamRepository.getActiveSessionCount(sessionData.team.id);
          registeredMemberCount = sessionData.team.registeredMemberCount;
        }
      }

      const payload = {
        eventStatus: settings?.status || 'NOT_STARTED',
        durationMinutes: settings?.durationMinutes || 60,
        connectedMemberCount,
        registeredMemberCount,
        timestamp: new Date().toISOString(),
      };

      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch {
      // Client disconnected
    }
  };

  await sendStatus();

  // Poll server state periodically as fallback
  const intervalId = setInterval(sendStatus, 4000);

  req.on('close', () => {
    clearInterval(intervalId);
    if (registeredConnId) {
      teamRealtimeService.unregisterClient(registeredConnId);
    }
    res.end();
  });
});

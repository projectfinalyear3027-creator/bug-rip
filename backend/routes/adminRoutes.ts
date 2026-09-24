/**
 * BUG RIP - Admin & Organizer API Routes
 * Backed strictly by PostgreSQL / PGlite database.
 * Completely separate from participant authentication.
 */

import { Router, Request, Response } from 'express';
import { adminRepository } from '../repositories/adminRepository.ts';
import { challengeRepository } from '../repositories/challengeRepository.ts';
import { eventRepository } from '../repositories/eventRepository.ts';
import { antiCheatRepository } from '../repositories/antiCheatRepository.ts';
import { progressionService } from '../services/progressionService.ts';
import { requireAdmin, requireSuperAdmin, extractAdminToken } from '../middleware/authMiddleware.ts';
import { adminLoginRateLimiter } from '../middleware/rateLimiter.ts';
import { teamRealtimeService } from '../services/teamRealtimeService.ts';
import { leaderboardRealtimeService } from '../services/leaderboardRealtimeService.ts';
import { csvImportService } from '../services/csvImportService.ts';

export const adminRouter = Router();

/**
 * Helper to set secure HTTP-only admin cookie
 */
function setAdminSessionCookie(req: Request, res: Response, token: string) {
  // Dynamically determine HTTPS vs HTTP:
  // - On HTTPS (or behind Cloud Run / reverse proxy with x-forwarded-proto: https): secure=true, sameSite='none'
  // - On local HTTP (e.g. http://localhost:3000): secure=false, sameSite='lax' so browsers do not reject it
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie('bugrip_admin_session', token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
    path: '/',
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  });
}

/**
 * 1. Admin Login
 * POST /api/admin/login
 * Body: { username, password }
 */
adminRouter.post('/login', adminLoginRateLimiter, async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(401).json({
        success: false,
        error: 'INVALID ADMIN CREDENTIALS',
        code: 'INVALID_CREDENTIALS',
      });
    }

    const adminUser = await adminRepository.verifyAdminCredentials(username, password);

    const ipAddress = (req.ip || req.socket.remoteAddress || 'unknown').toString();
    const userAgent = req.headers['user-agent'] || 'unknown';

    if (!adminUser) {
      // Record failed login in audit log
      await adminRepository.recordAuditLog({
        action: 'ADMIN_LOGIN_FAILURE',
        targetType: 'AUTH',
        targetId: username.trim(),
        reason: 'Failed login attempt with invalid credentials',
        metadata: { ipAddress, userAgent },
      });

      return res.status(401).json({
        success: false,
        error: 'INVALID ADMIN CREDENTIALS',
        code: 'INVALID_CREDENTIALS',
      });
    }

    // Create session in database
    const { sessionToken, session } = await adminRepository.createAdminSession(adminUser.id, {
      ipAddress,
      userAgent,
      durationHours: 8,
    });

    // Record successful login in audit log
    await adminRepository.recordAuditLog({
      adminUserId: adminUser.id,
      action: 'ADMIN_LOGIN_SUCCESS',
      targetType: 'AUTH',
      targetId: adminUser.username,
      reason: 'Administrator authenticated successfully',
      metadata: { ipAddress, userAgent },
    });

    // Set HTTP-only cookie
    setAdminSessionCookie(req, res, sessionToken);

    return res.json({
      success: true,
      admin: {
        id: adminUser.id,
        username: adminUser.username,
        displayName: adminUser.displayName,
        role: adminUser.role,
      },
      adminUser: {
        id: adminUser.id,
        username: adminUser.username,
        displayName: adminUser.displayName,
        role: adminUser.role,
      },
      sessionToken,
      expiresAt: session.expiresAt,
    });
  } catch (err: any) {
    console.error('Admin login exception:', err);
    return res.status(500).json({
      success: false,
      error: 'UNABLE TO VERIFY ADMIN CREDENTIALS. PLEASE TRY AGAIN.',
      code: 'SERVER_ERROR',
    });
  }
});

/**
 * 2. Admin Logout
 * POST /api/admin/logout
 */
adminRouter.post('/logout', async (req: Request, res: Response) => {
  try {
    const adminToken = extractAdminToken(req);
    if (adminToken) {
      const session = await adminRepository.validateAdminSession(adminToken);
      if (session) {
        await adminRepository.recordAuditLog({
          adminUserId: session.adminUserId,
          action: 'ADMIN_LOGOUT',
          targetType: 'AUTH',
          targetId: session.adminUser.username,
          reason: 'Administrator terminated session',
        });
      }
      await adminRepository.revokeAdminSession(adminToken);
    }

    res.clearCookie('bugrip_admin_session', { path: '/' });

    return res.json({
      success: true,
      message: 'Admin session terminated successfully.',
    });
  } catch (err) {
    console.error('Admin logout exception:', err);
    res.clearCookie('bugrip_admin_session', { path: '/' });
    return res.json({ success: true });
  }
});

/**
 * 3. Admin Session Restoration
 * GET /api/admin/session
 */
adminRouter.get('/session', async (req: Request, res: Response) => {
  try {
    const adminToken = extractAdminToken(req);
    if (!adminToken) {
      return res.status(401).json({
        authenticated: false,
        error: 'No admin session token provided.',
      });
    }

    const sessionRecord = await adminRepository.validateAdminSession(adminToken);
    if (!sessionRecord) {
      res.clearCookie('bugrip_admin_session', { path: '/' });
      return res.status(401).json({
        authenticated: false,
        error: 'Admin session invalid or expired.',
      });
    }

    return res.json({
      authenticated: true,
      admin: {
        id: sessionRecord.adminUser.id,
        username: sessionRecord.adminUser.username,
        displayName: sessionRecord.adminUser.displayName,
        role: sessionRecord.adminUser.role,
      },
      adminUser: {
        id: sessionRecord.adminUser.id,
        username: sessionRecord.adminUser.username,
        displayName: sessionRecord.adminUser.displayName,
        role: sessionRecord.adminUser.role,
      },
      expiresAt: sessionRecord.expiresAt,
    });
  } catch (err) {
    console.error('Admin session validation error:', err);
    return res.status(500).json({
      authenticated: false,
      error: 'Failed to validate admin session.',
    });
  }
});

/**
 * 4. Admin Dashboard Metrics
 * GET /api/admin/dashboard
 */
adminRouter.get('/dashboard', requireAdmin, async (req: Request, res: Response) => {
  try {
    const metrics = await adminRepository.getDashboardMetrics();
    return res.json({
      success: true,
      metrics,
    });
  } catch (err: any) {
    console.error('Failed to load admin dashboard:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve dashboard metrics.',
    });
  }
});

/**
 * Real-time Admin Monitoring Stream (SSE)
 * GET /api/admin/events or GET /api/admin/stream
 */
adminRouter.get('/events', requireAdmin, (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  teamRealtimeService.registerAdminClient(res);

  res.write(`event: admin.init\ndata: ${JSON.stringify({
    connectedParticipants: teamRealtimeService.getTotalConnectedParticipants(),
    connectedTeams: teamRealtimeService.getTotalConnectedTeams(),
    timestamp: new Date().toISOString(),
  })}\n\n`);
});

adminRouter.get('/stream', requireAdmin, (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  teamRealtimeService.registerAdminClient(res);

  res.write(`event: admin.init\ndata: ${JSON.stringify({
    connectedParticipants: teamRealtimeService.getTotalConnectedParticipants(),
    connectedTeams: teamRealtimeService.getTotalConnectedTeams(),
    timestamp: new Date().toISOString(),
  })}\n\n`);
});

/**
 * 5. Teams Overview
 * GET /api/admin/teams
 */
adminRouter.get('/teams', requireAdmin, async (req: Request, res: Response) => {
  try {
    const teams = await adminRepository.getTeamsOverview();
    return res.json({
      success: true,
      teams,
    });
  } catch (err) {
    console.error('Failed to load teams overview:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve teams overview.',
    });
  }
});

/**
 * 6. Single Team Details
 * GET /api/admin/teams/:id
 */
adminRouter.get('/teams/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const team = await adminRepository.getTeamDetails(req.params.id);
    if (!team) {
      return res.status(404).json({
        success: false,
        error: 'Team not found.',
      });
    }
    return res.json({
      success: true,
      team,
    });
  } catch (err) {
    console.error('Failed to load team details:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve team details.',
    });
  }
});

/**
 * 7. Participants Overview
 * GET /api/admin/participants
 */
adminRouter.get('/participants', requireAdmin, async (req: Request, res: Response) => {
  try {
    const statusFilter = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : 'ACTIVE';
    const participants = await adminRepository.getParticipantsOverview(statusFilter);
    return res.json({
      success: true,
      participants,
    });
  } catch (err) {
    console.error('Failed to load participants overview:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve participants overview.',
    });
  }
});

/**
 * 7e. Safe Admin Participant Deactivation / Removal
 * POST /api/admin/participants/:participantId/deactivate
 * DELETE /api/admin/participants/:participantId (alias)
 * Body: { reason?: string }
 */
adminRouter.post(
  ['/participants/:participantId/deactivate', '/participants/:participantId/remove'],
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { participantId } = req.params;
      const { reason } = req.body || {};
      const adminUserId = req.adminUser!.id;

      const result = await adminRepository.deactivateParticipant(participantId, adminUserId, reason);
      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }
      return res.status(result.statusCode || 200).json(result);
    } catch (err: any) {
      console.error('Participant deactivation error:', err);
      return res.status(500).json({
        success: false,
        error: err.message || 'Failed to remove participant.',
      });
    }
  }
);

adminRouter.delete('/participants/:participantId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { participantId } = req.params;
    const { reason } = req.body || {};
    const adminUserId = req.adminUser!.id;

    const result = await adminRepository.deactivateParticipant(participantId, adminUserId, reason);
    if (!result.success) {
      return res.status(result.statusCode || 400).json(result);
    }
    return res.status(result.statusCode || 200).json(result);
  } catch (err: any) {
    console.error('Participant removal error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to remove participant.',
    });
  }
});

/**
 * 7f. Admin Participant Reactivation
 * POST /api/admin/participants/:participantId/reactivate
 * Body: { reason?: string }
 */
adminRouter.post('/participants/:participantId/reactivate', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { participantId } = req.params;
    const { reason } = req.body || {};
    const adminUserId = req.adminUser!.id;

    const result = await adminRepository.reactivateParticipant(participantId, adminUserId, reason);
    if (!result.success) {
      return res.status(result.statusCode || 400).json(result);
    }
    return res.status(result.statusCode || 200).json(result);
  } catch (err: any) {
    console.error('Participant reactivation error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to reactivate participant.',
    });
  }
});

/**
 * 7b. Registration Summary & Statistics
 * GET /api/admin/participants/stats
 */
adminRouter.get('/participants/stats', requireAdmin, async (req: Request, res: Response) => {
  try {
    const stats = await csvImportService.getRegistrationStats();
    return res.json({
      success: true,
      stats,
    });
  } catch (err) {
    console.error('Failed to load registration statistics:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve registration statistics.',
    });
  }
});

/**
 * 7c. Phase 1: Validate Participant CSV
 * POST /api/admin/participants/validate-csv
 * POST /api/admin/participants/import/validate (alias)
 * Body: { csvContent: string }
 */
adminRouter.post(
  ['/participants/validate-csv', '/participants/import/validate'],
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { csvContent } = req.body;
      if (typeof csvContent !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Invalid request: "csvContent" string is required.',
        });
      }

      const adminUser = (req as any).adminUser;
      const result = await csvImportService.validateCsvImport(csvContent, adminUser?.id);

      return res.json({
        success: true,
        validation: result,
        ...result,
      });
    } catch (err: any) {
      console.error('CSV validation error:', err);
      return res.status(500).json({
        success: false,
        error: err.message || 'Failed to validate CSV.',
      });
    }
  }
);

/**
 * 7d. Phase 2: Confirm and Ingest Participant CSV
 * POST /api/admin/participants/confirm-csv
 * POST /api/admin/participants/import/confirm (alias)
 * Body: { confirm: true, csvContent: string }
 */
adminRouter.post(
  ['/participants/confirm-csv', '/participants/import/confirm'],
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { confirm = true, csvContent } = req.body;
      if (!confirm) {
        return res.status(400).json({
          success: false,
          error: 'Confirmation required. Explicitly supply { confirm: true } to commit registration.',
        });
      }

      if (typeof csvContent !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Invalid request: "csvContent" string is required.',
        });
      }

      const adminUser = (req as any).adminUser;
      const result = await csvImportService.confirmCsvImport(csvContent, {
        id: adminUser.id,
        username: adminUser.username,
      });

      try {
        teamRealtimeService.broadcastToAdmin('admin.metrics.updated', {
          reason: 'PARTICIPANTS_IMPORTED',
          timestamp: new Date().toISOString(),
        });
        leaderboardRealtimeService.notifyLeaderboardUpdated();
      } catch (err) {}

      return res.json({
        success: true,
        message: result.message,
        stats: result.stats,
        importedAt: result.importedAt,
      });
    } catch (err: any) {
    console.error('CSV import confirmation error:', err);
    if (err.message && err.message.includes('COMPETITION_ACTIVE_LOCKED')) {
      return res.status(409).json({
        success: false,
        code: 'COMPETITION_ACTIVE_LOCKED',
        error: err.message,
      });
    }
    if (err.message && err.message.includes('IMPORT_VALIDATION_FAILED')) {
      return res.status(400).json({
        success: false,
        code: 'IMPORT_VALIDATION_FAILED',
        error: err.message,
      });
    }
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to confirm registration import.',
    });
  }
});

/**
 * 8. Event Settings & Readiness
 * GET /api/admin/event
 */
adminRouter.get('/event', requireAdmin, async (req: Request, res: Response) => {
  try {
    const metrics = await adminRepository.getDashboardMetrics();
    const readiness = await adminRepository.validateEventStartPreconditions();

    return res.json({
      success: true,
      event: {
        status: metrics.eventStatus,
        durationMinutes: metrics.durationMinutes,
        startedAt: metrics.startedAt,
        pausedAt: metrics.pausedAt,
        endedAt: metrics.endedAt,
      },
      readiness,
    });
  } catch (err) {
    console.error('Failed to load event settings:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve event configuration.',
    });
  }
});

/**
 * 8b. Event Start Preconditions
 * GET /api/admin/event/preconditions
 */
adminRouter.get('/event/preconditions', requireAdmin, async (req: Request, res: Response) => {
  try {
    const metrics = await adminRepository.getDashboardMetrics();
    const readiness = await adminRepository.validateEventStartPreconditions();
    const activeChallenges = await challengeRepository.getChallenges();

    return res.json({
      success: true,
      preconditions: {
        canStart: readiness.canStart,
        currentStatus: metrics.eventStatus,
        activeParticipantCount: metrics.registeredParticipantsCount,
        registeredParticipantsCount: metrics.registeredParticipantsCount,
        activeTeamCount: metrics.registeredParticipantsCount,
        challengeCount: activeChallenges.length,
        errors: readiness.errors,
        warnings: readiness.warnings,
      },
    });
  } catch (err) {
    console.error('Failed to load event preconditions:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve event preconditions.',
    });
  }
});

/**
 * 9. Start Event
 * POST /api/admin/event/start
 */
adminRouter.post('/event/start', requireAdmin, async (req: Request, res: Response) => {
  try {
    const adminId = req.adminUser?.id || '00000000-0000-0000-0000-000000000001';
    const result = await adminRepository.transitionEventStatus('RUNNING', adminId, 'START');

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error || 'Failed to start event.',
        code: 'EVENT_START_REJECTED',
      });
    }

    try {
      teamRealtimeService.broadcastGlobal('event.status.changed', {
        status: 'RUNNING',
        message: 'BUG SNIPER competition started.',
        timestamp: new Date().toISOString(),
      });
      leaderboardRealtimeService.broadcastEventStatusChanged({
        status: 'RUNNING',
        message: 'BUG SNIPER competition started.',
        timestamp: new Date().toISOString(),
      });
      leaderboardRealtimeService.notifyLeaderboardUpdated();
    } catch {}

    return res.json({
      success: true,
      message: 'BUG SNIPER competition started successfully.',
      event: result.event,
    });
  } catch (err: any) {
    console.error('Start event error:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error while starting event.',
    });
  }
});

/**
 * 10. Pause Event
 * POST /api/admin/event/pause
 */
adminRouter.post('/event/pause', requireAdmin, async (req: Request, res: Response) => {
  try {
    const adminId = req.adminUser?.id || '00000000-0000-0000-0000-000000000001';
    const result = await adminRepository.transitionEventStatus('PAUSED', adminId, 'PAUSE');

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error || 'Failed to pause event.',
      });
    }

    try {
      teamRealtimeService.broadcastGlobal('event.status.changed', {
        status: 'PAUSED',
        message: 'BUG SNIPER competition paused.',
        timestamp: new Date().toISOString(),
      });
      leaderboardRealtimeService.broadcastEventStatusChanged({
        status: 'PAUSED',
        message: 'BUG SNIPER competition paused.',
        timestamp: new Date().toISOString(),
      });
      leaderboardRealtimeService.notifyLeaderboardUpdated();
    } catch {}

    return res.json({
      success: true,
      message: 'BUG SNIPER competition paused.',
      event: result.event,
    });
  } catch (err: any) {
    console.error('Pause event error:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error while pausing event.',
    });
  }
});

/**
 * 11. Resume Event
 * POST /api/admin/event/resume
 */
adminRouter.post('/event/resume', requireAdmin, async (req: Request, res: Response) => {
  try {
    const adminId = req.adminUser?.id || '00000000-0000-0000-0000-000000000001';
    const result = await adminRepository.transitionEventStatus('RUNNING', adminId, 'RESUME');

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error || 'Failed to resume event.',
      });
    }

    try {
      teamRealtimeService.broadcastGlobal('event.status.changed', {
        status: 'RUNNING',
        message: 'BUG SNIPER competition resumed.',
        timestamp: new Date().toISOString(),
      });
      leaderboardRealtimeService.broadcastEventStatusChanged({
        status: 'RUNNING',
        message: 'BUG SNIPER competition resumed.',
        timestamp: new Date().toISOString(),
      });
      leaderboardRealtimeService.notifyLeaderboardUpdated();
    } catch {}

    return res.json({
      success: true,
      message: 'BUG SNIPER competition resumed.',
      event: result.event,
    });
  } catch (err: any) {
    console.error('Resume event error:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error while resuming event.',
    });
  }
});

/**
 * 12. End Event (Destructive Action)
 * POST /api/admin/event/end
 * Body: { confirm: true }
 */
adminRouter.post('/event/end', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { confirm } = req.body;
    if (!confirm) {
      return res.status(400).json({
        success: false,
        error: 'Confirmation required. Pass { confirm: true } to permanently end the competition.',
        code: 'CONFIRMATION_REQUIRED',
      });
    }

    const adminId = req.adminUser?.id || '00000000-0000-0000-0000-000000000001';
    const result = await adminRepository.transitionEventStatus('ENDED', adminId, 'END');

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error || 'Failed to end event.',
      });
    }

    try {
      teamRealtimeService.broadcastGlobal('event.status.changed', {
        status: 'ENDED',
        message: 'BUG SNIPER competition ended.',
        timestamp: new Date().toISOString(),
      });
      leaderboardRealtimeService.broadcastEventStatusChanged({
        status: 'ENDED',
        message: 'BUG SNIPER competition ended.',
        timestamp: new Date().toISOString(),
      });
      leaderboardRealtimeService.notifyLeaderboardUpdated();
    } catch {}

    return res.json({
      success: true,
      message: 'BUG SNIPER competition ended and locked.',
      event: result.event,
    });
  } catch (err: any) {
    console.error('End event error:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error while ending event.',
    });
  }
});

/**
 * POST /api/admin/event/new-match
 * Explicit workflow to initialize a fresh competition run (Match 2, 3, etc.)
 * Preserves all historical match submissions, completions, and audit logs.
 * Requires admin authentication and explicit confirmation.
 * Body: { confirm: true, matchName?: string, durationMinutes?: number }
 */
adminRouter.post('/event/new-match', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { confirm, matchName, durationMinutes } = req.body;
    if (!confirm) {
      return res.status(400).json({
        success: false,
        error: 'Confirmation required. Pass { confirm: true } to create a new match run.',
        code: 'CONFIRMATION_REQUIRED',
      });
    }

    const adminId = req.adminUser?.id || '00000000-0000-0000-0000-000000000001';
    const result = await adminRepository.createNewMatch(adminId, {
      matchName,
      durationMinutes: durationMinutes ? Number(durationMinutes) : 60,
    });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error || 'Failed to create new match.',
      });
    }

    return res.json({
      success: true,
      message: `New match #${result.match.matchNumber} successfully initialized in NOT_STARTED state.`,
      match: result.match,
      event: result.event,
    });
  } catch (err: any) {
    console.error('New match error:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error while creating new match.',
    });
  }
});

/**
 * POST /api/admin/event/reset
 * Resets the competition back to NOT_STARTED via explicit new match / reset workflow.
 */
adminRouter.post('/event/reset', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { confirm, matchName, durationMinutes } = req.body;
    const adminId = req.adminUser?.id || '00000000-0000-0000-0000-000000000001';

    // Delegate to createNewMatch to strictly preserve history and follow authoritative state machine
    const result = await adminRepository.createNewMatch(adminId, {
      matchName,
      durationMinutes: durationMinutes ? Number(durationMinutes) : 60,
    });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error || 'Failed to reset competition.',
      });
    }

    return res.json({
      success: true,
      message: 'Competition reset to NOT_STARTED with fresh match state.',
      match: result.match,
      event: result.event,
    });
  } catch (err: any) {
    console.error('Reset event error:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to reset event status.',
    });
  }
});

/**
 * GET /api/admin/matches
 * Returns all competition matches and their historical states/results.
 */
adminRouter.get('/matches', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const matches = await adminRepository.getMatches();
    return res.json({
      success: true,
      matches,
    });
  } catch (err: any) {
    console.error('Fetch matches error:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve match history.',
    });
  }
});

/**
 * GET /api/admin/matches/:matchNumber/leaderboard
 * Returns the final or live leaderboard for a specific match.
 */
adminRouter.get('/matches/:matchNumber/leaderboard', requireAdmin, async (req: Request, res: Response) => {
  try {
    const matchNumber = parseInt(req.params.matchNumber, 10);
    if (isNaN(matchNumber) || matchNumber < 1) {
      return res.status(400).json({
        success: false,
        error: 'Invalid match number.',
      });
    }

    const data = await adminRepository.getMatchLeaderboard(matchNumber);
    if (!data) {
      return res.status(404).json({
        success: false,
        error: `Match #${matchNumber} not found.`,
      });
    }

    return res.json({
      success: true,
      ...data,
    });
  } catch (err: any) {
    console.error('Fetch match leaderboard error:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve match leaderboard.',
    });
  }
});

/**
 * 13. Audit Logs
 * GET /api/admin/audit
 */
adminRouter.get('/audit', requireAdmin, async (req: Request, res: Response) => {
  try {
    const logs = await adminRepository.getAuditLogs(100);
    return res.json({
      success: true,
      logs,
    });
  } catch (err) {
    console.error('Failed to load audit logs:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve audit logs.',
    });
  }
});

/**
 * -----------------------------------------------------------------------------
 * FRAGMENT 6 - ROUNDS, CHALLENGES & PROGRESSION MANAGEMENT
 * -----------------------------------------------------------------------------
 */

/**
 * 14. List Rounds with Active Challenges Count & Threshold Validation
 * GET /api/admin/rounds
 */
adminRouter.get('/rounds', requireAdmin, async (req: Request, res: Response) => {
  try {
    const rounds = await progressionService.getRoundsWithValidation();
    return res.json({
      success: true,
      rounds,
    });
  } catch (err: any) {
    console.error('Failed to list rounds:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve rounds configuration.',
    });
  }
});

/**
 * 15. Create Round (Extensible Difficulty Level)
 * POST /api/admin/rounds
 */
adminRouter.post('/rounds', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name, slug, displayOrder, unlockRequiredSolves, isActive } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Round name is required.' });
    }
    if (!slug || typeof slug !== 'string' || !slug.trim()) {
      return res.status(400).json({ success: false, error: 'Round slug is required.' });
    }
    if (displayOrder === undefined || typeof displayOrder !== 'number' || displayOrder < 0) {
      return res.status(400).json({ success: false, error: 'Valid displayOrder number >= 0 is required.' });
    }
    if (unlockRequiredSolves !== undefined && (typeof unlockRequiredSolves !== 'number' || unlockRequiredSolves < 0)) {
      return res.status(400).json({ success: false, error: 'Unlock required solves cannot be negative.' });
    }

    // Check slug uniqueness
    const existingSlug = await challengeRepository.getRoundBySlug(slug);
    if (existingSlug) {
      return res.status(400).json({ success: false, error: `Round slug "${slug}" already exists.` });
    }

    const round = await challengeRepository.createRound({
      name,
      slug,
      displayOrder,
      unlockRequiredSolves: unlockRequiredSolves ?? 0,
      isActive: isActive ?? true,
    });

    const adminUserId = req.adminUser?.id;
    await adminRepository.recordAuditLog({
      adminUserId,
      action: 'DIFFICULTY_CREATED',
      targetType: 'ROUND',
      targetId: round.id,
      reason: `Admin created new round "${round.name}" (order ${round.displayOrder})`,
      metadata: { round },
    });

    return res.status(201).json({
      success: true,
      message: `Round "${round.name}" created successfully.`,
      round,
    });
  } catch (err: any) {
    console.error('Failed to create round:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to create round.',
    });
  }
});

/**
 * 16. Update Round (Order, Threshold, Active Status)
 * PATCH /api/admin/rounds/:id
 */
adminRouter.patch('/rounds/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const roundId = req.params.id;
    const existing = await challengeRepository.getRoundById(roundId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Round not found.' });
    }

    const { name, slug, displayOrder, unlockRequiredSolves, isActive } = req.body;

    if (name !== undefined && (!name || typeof name !== 'string' || !name.trim())) {
      return res.status(400).json({ success: false, error: 'Round name cannot be empty.' });
    }
    if (slug !== undefined && (!slug || typeof slug !== 'string' || !slug.trim())) {
      return res.status(400).json({ success: false, error: 'Round slug cannot be empty.' });
    }
    if (displayOrder !== undefined && (typeof displayOrder !== 'number' || displayOrder < 0)) {
      return res.status(400).json({ success: false, error: 'Display order must be >= 0.' });
    }
    if (unlockRequiredSolves !== undefined && (typeof unlockRequiredSolves !== 'number' || unlockRequiredSolves < 0)) {
      return res.status(400).json({ success: false, error: 'Unlock required solves cannot be negative.' });
    }

    const updated = await challengeRepository.updateRound(roundId, {
      name,
      slug,
      displayOrder,
      unlockRequiredSolves,
      isActive,
    });

    const adminUserId = req.adminUser?.id;
    let auditAction = 'DIFFICULTY_UPDATED';
    if (isActive !== undefined && isActive !== existing.isActive) {
      auditAction = isActive ? 'DIFFICULTY_ACTIVATED' : 'DIFFICULTY_DEACTIVATED';
    } else if (unlockRequiredSolves !== undefined && unlockRequiredSolves !== existing.unlockRequiredSolves) {
      auditAction = 'UNLOCK_THRESHOLD_CHANGED';
    }

    await adminRepository.recordAuditLog({
      adminUserId,
      action: auditAction,
      targetType: 'ROUND',
      targetId: roundId,
      reason: `Admin updated round "${existing.name}"`,
      metadata: { previous: existing, updated },
    });

    return res.json({
      success: true,
      message: `Round "${updated?.name}" updated successfully.`,
      round: updated,
    });
  } catch (err: any) {
    console.error('Failed to update round:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to update round.',
    });
  }
});

/**
 * 17. List All Challenges (Admin Search & Filters)
 * GET /api/admin/challenges
 */
adminRouter.get('/challenges', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { roundId, isActive, search } = req.query;

    const filters: any = {};
    if (roundId && typeof roundId === 'string') {
      filters.roundId = roundId;
    }
    if (isActive !== undefined) {
      filters.isActive = isActive === 'true';
    }
    if (search && typeof search === 'string') {
      filters.search = search;
    }

    const challengesList = await challengeRepository.getAllChallenges(filters);

    return res.json({
      success: true,
      challenges: challengesList,
    });
  } catch (err: any) {
    console.error('Failed to list challenges:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve challenges.',
    });
  }
});

/**
 * 18. Create Challenge
 * POST /api/admin/challenges
 */
adminRouter.post('/challenges', requireAdmin, async (req: Request, res: Response) => {
  try {
    const {
      id,
      roundId,
      title,
      slug,
      description,
      starterCode,
      solutionCode,
      adminNotes,
      score,
      displayOrder,
      validationType,
      timeLimitMs,
      memoryLimitMb,
      maxOutputBytes,
      maxSourceBytes,
      isActive,
      testCases,
      flagVerifier,
    } = req.body;

    if (!id || typeof id !== 'string' || !id.trim()) {
      return res.status(400).json({ success: false, error: 'Challenge ID is required (e.g. EASY-01-FACTORIAL).' });
    }
    if (!roundId || typeof roundId !== 'string') {
      return res.status(400).json({ success: false, error: 'Round/Difficulty ID is required.' });
    }
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ success: false, error: 'Challenge title is required.' });
    }
    if (!description || typeof description !== 'string') {
      return res.status(400).json({ success: false, error: 'Challenge description is required.' });
    }
    if (!starterCode || typeof starterCode !== 'string') {
      return res.status(400).json({ success: false, error: 'Starter Java code is required.' });
    }
    if (score === undefined || typeof score !== 'number' || score < 1) {
      return res.status(400).json({ success: false, error: 'Score must be a positive integer >= 1.' });
    }
    if (timeLimitMs !== undefined && (typeof timeLimitMs !== 'number' || timeLimitMs <= 0)) {
      return res.status(400).json({ success: false, error: 'Time limit must be a positive integer.' });
    }
    if (memoryLimitMb !== undefined && (typeof memoryLimitMb !== 'number' || memoryLimitMb <= 0)) {
      return res.status(400).json({ success: false, error: 'Memory limit must be a positive integer.' });
    }

    // Verify round exists
    const round = await challengeRepository.getRoundById(roundId);
    if (!round) {
      return res.status(400).json({ success: false, error: 'Specified difficulty/round does not exist.' });
    }

    // Verify challenge ID uniqueness
    const existing = await challengeRepository.getChallengeById(id.trim());
    if (existing) {
      return res.status(400).json({ success: false, error: `Challenge with ID "${id}" already exists.` });
    }

    const genSlug = slug && typeof slug === 'string' ? slug.trim().toLowerCase() : id.trim().toLowerCase();

    const created = await challengeRepository.createChallenge({
      id: id.trim(),
      roundId,
      title: title.trim(),
      slug: genSlug,
      description,
      starterCode,
      solutionCode,
      adminNotes,
      score,
      displayOrder: displayOrder ?? 0,
      validationType: validationType ?? 'EXACT_OUTPUT',
      timeLimitMs: timeLimitMs ?? 3000,
      memoryLimitMb: memoryLimitMb ?? 256,
      maxOutputBytes: maxOutputBytes ?? 65536,
      maxSourceBytes: maxSourceBytes ?? 32768,
      isActive: isActive ?? true,
      testCases,
      flagVerifier,
    });

    const adminUserId = req.adminUser?.id;
    await adminRepository.recordAuditLog({
      adminUserId,
      action: 'CHALLENGE_CREATED',
      targetType: 'CHALLENGE',
      targetId: created.id,
      reason: `Admin created challenge "${created.title}" in ${round.name}`,
      metadata: { challengeId: created.id, score: created.score, roundId },
    });

    return res.status(201).json({
      success: true,
      message: `Challenge "${created.title}" created successfully.`,
      challenge: created,
    });
  } catch (err: any) {
    console.error('Failed to create challenge:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to create challenge.',
    });
  }
});

/**
 * 19. Get Challenge Details for Admin
 * GET /api/admin/challenges/:id
 */
adminRouter.get('/challenges/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const challengeId = req.params.id;
    const chal = await challengeRepository.getChallengeById(challengeId);
    if (!chal) {
      return res.status(404).json({ success: false, error: 'Challenge not found.' });
    }

    const [testCases, flagVerifier, round] = await Promise.all([
      challengeRepository.getTestCases(challengeId, true), // include hidden for admin
      challengeRepository.getFlagVerifier(challengeId),
      challengeRepository.getRoundById(chal.roundId),
    ]);

    return res.json({
      success: true,
      challenge: {
        ...chal,
        round,
        testCases,
        flagVerifier: flagVerifier?.flagVerifier ?? null,
      },
    });
  } catch (err: any) {
    console.error('Failed to get challenge details:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve challenge details.',
    });
  }
});

/**
 * 20. Update Challenge
 * PATCH /api/admin/challenges/:id
 */
adminRouter.patch('/challenges/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const challengeId = req.params.id;
    const existing = await challengeRepository.getChallengeById(challengeId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Challenge not found.' });
    }

    const {
      roundId,
      title,
      slug,
      description,
      starterCode,
      solutionCode,
      adminNotes,
      score,
      displayOrder,
      validationType,
      timeLimitMs,
      memoryLimitMb,
      maxOutputBytes,
      maxSourceBytes,
      isActive,
    } = req.body;

    if (title !== undefined && (!title || typeof title !== 'string' || !title.trim())) {
      return res.status(400).json({ success: false, error: 'Title cannot be empty.' });
    }
    if (score !== undefined && (typeof score !== 'number' || score < 1)) {
      return res.status(400).json({ success: false, error: 'Score must be a positive integer >= 1.' });
    }
    if (timeLimitMs !== undefined && (typeof timeLimitMs !== 'number' || timeLimitMs <= 0)) {
      return res.status(400).json({ success: false, error: 'Time limit must be positive.' });
    }
    if (memoryLimitMb !== undefined && (typeof memoryLimitMb !== 'number' || memoryLimitMb <= 0)) {
      return res.status(400).json({ success: false, error: 'Memory limit must be positive.' });
    }

    if (roundId !== undefined) {
      const round = await challengeRepository.getRoundById(roundId);
      if (!round) {
        return res.status(400).json({ success: false, error: 'Specified difficulty does not exist.' });
      }
    }

    const updated = await challengeRepository.updateChallenge(challengeId, {
      roundId,
      title,
      slug,
      description,
      starterCode,
      solutionCode,
      adminNotes,
      score,
      displayOrder,
      validationType,
      timeLimitMs,
      memoryLimitMb,
      maxOutputBytes,
      maxSourceBytes,
      isActive,
    });

    const adminUserId = req.adminUser?.id;
    await adminRepository.recordAuditLog({
      adminUserId,
      action: 'CHALLENGE_UPDATED',
      targetType: 'CHALLENGE',
      targetId: challengeId,
      reason: `Admin updated challenge "${existing.title}"`,
      metadata: { previousScore: existing.score, newScore: updated?.score },
    });

    return res.json({
      success: true,
      message: `Challenge "${updated?.title}" updated successfully.`,
      challenge: updated,
    });
  } catch (err: any) {
    console.error('Failed to update challenge:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to update challenge.',
    });
  }
});

/**
 * 21. Activate Challenge
 * POST /api/admin/challenges/:id/activate
 */
adminRouter.post('/challenges/:id/activate', requireAdmin, async (req: Request, res: Response) => {
  try {
    const challengeId = req.params.id;
    const existing = await challengeRepository.getChallengeById(challengeId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Challenge not found.' });
    }

    const updated = await challengeRepository.setChallengeActive(challengeId, true);

    const adminUserId = req.adminUser?.id;
    await adminRepository.recordAuditLog({
      adminUserId,
      action: 'CHALLENGE_ACTIVATED',
      targetType: 'CHALLENGE',
      targetId: challengeId,
      reason: `Admin activated challenge "${existing.title}"`,
    });

    return res.json({
      success: true,
      message: `Challenge "${updated?.title}" is now active.`,
      challenge: updated,
    });
  } catch (err: any) {
    console.error('Failed to activate challenge:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to activate challenge.',
    });
  }
});

/**
 * 22. Deactivate Challenge (With Progression Invalidation Warning)
 * POST /api/admin/challenges/:id/deactivate
 */
adminRouter.post('/challenges/:id/deactivate', requireAdmin, async (req: Request, res: Response) => {
  try {
    const challengeId = req.params.id;
    const existing = await challengeRepository.getChallengeById(challengeId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Challenge not found.' });
    }

    // Check impact on downstream unlock configuration
    const { warning } = await progressionService.checkDeactivationImpact(challengeId);

    const updated = await challengeRepository.setChallengeActive(challengeId, false);

    const adminUserId = req.adminUser?.id;
    await adminRepository.recordAuditLog({
      adminUserId,
      action: 'CHALLENGE_DEACTIVATED',
      targetType: 'CHALLENGE',
      targetId: challengeId,
      reason: `Admin deactivated challenge "${existing.title}". ${warning ? `Warning: ${warning}` : ''}`,
      metadata: { warning },
    });

    return res.json({
      success: true,
      message: `Challenge "${updated?.title}" has been deactivated.`,
      challenge: updated,
      warning,
    });
  } catch (err: any) {
    console.error('Failed to deactivate challenge:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to deactivate challenge.',
    });
  }
});

/**
 * 23. Admin Progression: Unlock All Difficulties
 * POST /api/admin/progression/unlock-all
 */
adminRouter.post('/progression/unlock-all', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { reason } = req.body;
    const adminUserId = req.adminUser?.id;
    const result = await progressionService.unlockAllDifficulties(adminUserId, reason);
    return res.json(result);
  } catch (err: any) {
    console.error('Failed to unlock all difficulties:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to unlock all difficulties.',
    });
  }
});

/**
 * 24. Admin Progression: Unlock Difficulty for Participant or All
 * POST /api/admin/progression/unlock-difficulty
 */
adminRouter.post('/progression/unlock-difficulty', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { roundId, reason } = req.body;
    const targetId = req.body.participantId || req.body.teamId;
    if (!roundId) {
      return res.status(400).json({ success: false, error: 'roundId is required.' });
    }

    const adminUserId = req.adminUser?.id;
    const result = await progressionService.unlockDifficulty(roundId, targetId, adminUserId, reason);
    return res.json(result);
  } catch (err: any) {
    console.error('Failed to unlock difficulty:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.message || 'Failed to unlock difficulty.',
    });
  }
});

/**
 * 25. Admin Progression: Unlock Challenge for Participant or All
 * POST /api/admin/progression/unlock-challenge
 */
adminRouter.post('/progression/unlock-challenge', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { challengeId, reason } = req.body;
    const targetId = req.body.participantId || req.body.teamId;
    if (!challengeId) {
      return res.status(400).json({ success: false, error: 'challengeId is required.' });
    }

    const adminUserId = req.adminUser?.id;
    const result = await progressionService.unlockChallenge(challengeId, targetId, adminUserId, reason);
    return res.json(result);
  } catch (err: any) {
    console.error('Failed to unlock challenge:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.message || 'Failed to unlock challenge.',
    });
  }
});

// =============================================================================
// Anti-Cheat & Competition Integrity Endpoints (Fragment 12)
// =============================================================================

/**
 * 26. Admin: Query Anti-Cheat Events
 * GET /api/admin/anti-cheat/events
 * Query: { teamId, eventType, actionTaken, limit, offset }
 */
adminRouter.get('/anti-cheat/events', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { teamId, eventType, actionTaken, limit, offset } = req.query;

    const parsedLimit = limit ? parseInt(limit as string, 10) : 50;
    const parsedOffset = offset ? parseInt(offset as string, 10) : 0;

    const [events, total] = await Promise.all([
      antiCheatRepository.getEvents({
        teamId: typeof teamId === 'string' && teamId ? teamId : undefined,
        eventType: typeof eventType === 'string' && eventType ? eventType : undefined,
        actionTaken: typeof actionTaken === 'string' && actionTaken ? actionTaken : undefined,
        limit: parsedLimit,
        offset: parsedOffset,
      }),
      antiCheatRepository.getEventsCount({
        teamId: typeof teamId === 'string' && teamId ? teamId : undefined,
        eventType: typeof eventType === 'string' && eventType ? eventType : undefined,
        actionTaken: typeof actionTaken === 'string' && actionTaken ? actionTaken : undefined,
      }),
    ]);

    return res.json({
      success: true,
      data: {
        events,
        total,
        limit: parsedLimit,
        offset: parsedOffset,
      },
    });
  } catch (err) {
    console.error('Failed to fetch anti-cheat events:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve anti-cheat events.',
    });
  }
});

/**
 * 27. Admin: Anti-Cheat Summary Statistics & High-Risk Teams
 * GET /api/admin/anti-cheat/summary
 */
adminRouter.get('/anti-cheat/summary', requireAdmin, async (req: Request, res: Response) => {
  try {
    const [stats, teamsByViolations] = await Promise.all([
      antiCheatRepository.getSummaryStats(),
      antiCheatRepository.getTeamsByViolations(),
    ]);

    return res.json({
      success: true,
      data: {
        stats,
        teams: teamsByViolations,
      },
    });
  } catch (err) {
    console.error('Failed to fetch anti-cheat summary:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve anti-cheat summary statistics.',
    });
  }
});

/**
 * 28. Admin: Team-Specific Anti-Cheat Timeline
 * GET /api/admin/anti-cheat/teams/:teamId
 */
adminRouter.get('/anti-cheat/teams/:teamId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { teamId } = req.params;
    const summary = await antiCheatRepository.getTeamSummary(teamId);

    return res.json({
      success: true,
      data: summary,
    });
  } catch (err) {
    console.error('Failed to fetch team anti-cheat timeline:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve team anti-cheat timeline.',
    });
  }
});

/**
 * 29. Admin: Review Anti-Cheat Event
 * POST /api/admin/anti-cheat/events/:id/review
 * Body: { actionTaken, adminNotes }
 */
adminRouter.post('/anti-cheat/events/:id/review', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { actionTaken, adminNotes } = req.body || {};
    const adminUserId = req.adminUser!.id;

    const reviewed = await antiCheatRepository.reviewEvent(id, adminUserId, {
      actionTaken,
      adminNotes,
    });

    if (!reviewed) {
      return res.status(404).json({
        success: false,
        error: 'Event not found.',
      });
    }

    // Record in audit log
    await adminRepository.recordAuditLog({
      adminUserId,
      action: 'TEAM_SUSPENSION',
      targetType: 'TEAM',
      targetId: reviewed.teamId,
      reason: `Anti-cheat event reviewed: ${reviewed.eventType}. Action: ${reviewed.actionTaken}`,
      metadata: { eventId: id, adminNotes, actionTaken: reviewed.actionTaken },
    });

    return res.json({
      success: true,
      message: 'Event reviewed successfully.',
      data: reviewed,
    });
  } catch (err) {
    console.error('Failed to review anti-cheat event:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to review anti-cheat event.',
    });
  }
});


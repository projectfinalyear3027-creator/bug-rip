/**
 * BUG SNIPER - Authoritative Participant Presence Routes
 *
 * Implements:
 * 1. POST /api/presence/heartbeat
 *    - Authenticated participant keep-alive & presence pulse.
 *    - Rejects attempts to spoof or update presence of another participant.
 * 2. GET /api/presence/status
 *    - Read-only snapshot of current match presence.
 */

import { Router, Request, Response } from 'express';
import { requireParticipantAuth } from '../middleware/authMiddleware.ts';
import { presenceService } from '../services/presenceService.ts';
import { eventService } from '../services/eventService.ts';

export const presenceRouter = Router();

/**
 * POST /api/presence/heartbeat
 * Periodic pulse from participant browser to update presence in the active match.
 */
presenceRouter.post('/heartbeat', requireParticipantAuth, async (req: Request, res: Response) => {
  try {
    const team = req.team!;
    const session = req.sessionRecord!;
    const participant = req.participant;
    const participantId = participant?.id || session.participantId || team.id;

    // Security: Participant can ONLY update their own presence
    const bodyParticipantId = req.body?.participantId || req.query?.participantId;
    if (bodyParticipantId && bodyParticipantId !== participantId) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: You cannot update presence for another participant.',
        code: 'PRESENCE_SPOOF_REJECTED',
      });
    }

    const eventStatus = await eventService.getEventStatus();
    const presenceResult = presenceService.recordHeartbeat({
      participantId,
      sessionId: session.id,
      matchNumber: eventStatus.currentMatchNumber,
      matchId: eventStatus.currentMatchId,
      isEnded: eventStatus.status === 'ENDED',
    });

    return res.json({
      success: true,
      participantId,
      matchNumber: eventStatus.currentMatchNumber,
      isOnline: presenceResult.isOnline,
      lastSeenAt: presenceResult.lastSeenAt,
    });
  } catch (err) {
    console.error('[PresenceRoutes] Heartbeat error:', err);
    return res.status(500).json({ success: false, error: 'Internal presence error' });
  }
});

/**
 * GET /api/presence/status
 * Public/Admin query for current presence counts and map
 */
presenceRouter.get('/status', async (req: Request, res: Response) => {
  try {
    const eventStatus = await eventService.getEventStatus();
    const queryMatch = req.query.matchNumber
      ? parseInt(req.query.matchNumber as string, 10)
      : eventStatus.currentMatchNumber;

    const snapshot = presenceService.getPresenceSnapshot(queryMatch);
    return res.json({
      success: true,
      eventStatus: eventStatus.status,
      ...snapshot,
    });
  } catch (err) {
    console.error('[PresenceRoutes] Status query error:', err);
    return res.status(500).json({ success: false, error: 'Internal presence error' });
  }
});

/**
 * BUG RIP - Anti-Cheat Routes
 * Participant endpoints for reporting browser integrity signals.
 * All team IDs and session IDs are strictly server-derived from verified authentication cookies.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requireParticipantAuth } from '../middleware/authMiddleware.ts';
import { antiCheatService } from '../services/antiCheatService.ts';
import { eventRepository } from '../repositories/eventRepository.ts';

export const antiCheatRouter = Router();

/**
 * POST /api/anti-cheat/events
 * Alias: POST /api/anti-cheat/event
 * Ingests client integrity signals (fullscreen change, tab visibility, blur/focus).
 */
const handleRecordEvent = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const participantId = req.participant?.id || req.sessionRecord?.participantId || null;
    const teamId = req.sessionRecord?.teamId || null;
    const sessionId = req.sessionRecord?.id || null;
    const { eventType, challengeId, metadata } = req.body || {};

    if (!eventType || typeof eventType !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'eventType is required and must be a string.',
        code: 'INVALID_EVENT_TYPE',
      });
    }

    const result = await antiCheatService.recordClientEvent({
      participantId,
      teamId,
      sessionId,
      challengeId: typeof challengeId === 'string' ? challengeId : null,
      eventType: eventType.trim().toUpperCase(),
      metadata: typeof metadata === 'object' && metadata !== null ? metadata : {},
    });

    if (result.throttled) {
      return res.status(200).json({
        success: true,
        recorded: false,
        throttled: true,
        message: result.reason || 'Event throttled to prevent flooding.',
      });
    }

    if (!result.recorded) {
      return res.status(400).json({
        success: false,
        error: result.reason || 'Failed to record event.',
        code: 'RECORD_FAILED',
      });
    }

    return res.status(201).json({
      success: true,
      recorded: true,
      event: {
        id: result.event?.id,
        eventType: result.event?.eventType,
        actionTaken: result.event?.actionTaken,
        createdAt: result.event?.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
};

antiCheatRouter.post('/events', requireParticipantAuth, handleRecordEvent);
antiCheatRouter.post('/event', requireParticipantAuth, handleRecordEvent);

/**
 * GET /api/anti-cheat/status
 * Returns authoritative anti-cheat configuration for the participant arena.
 */
antiCheatRouter.get('/status', requireParticipantAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const settings = await eventRepository.getEventSettings();

    return res.json({
      success: true,
      config: {
        fullscreenRequired: settings?.fullscreenRequired ?? false,
        eventStatus: settings?.status ?? 'NOT_STARTED',
        debounceMs: 800,
        monitoredEvents: [
          'FULLSCREEN_EXIT',
          'FULLSCREEN_ENTER',
          'TAB_HIDDEN',
          'TAB_VISIBLE',
          'WINDOW_BLUR',
          'WINDOW_FOCUS',
          'PAGE_RELOAD',
        ],
      },
    });
  } catch (err) {
    next(err);
  }
});

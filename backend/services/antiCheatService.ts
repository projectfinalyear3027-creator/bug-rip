/**
 * BUG RIP - Anti-Cheat & Participant Hardening Service
 * Coordinates participant integrity events, rate limiting, and evidence collection.
 * 
 * Philosophy:
 * DETECT -> RECORD -> SURFACE TO ADMIN -> PRESERVE EVIDENCE
 * Do NOT automatically permanently disqualify a team solely from unreliable browser signals.
 */

import { antiCheatRepository, AntiCheatEventType, AntiCheatAction, AntiCheatEventRecord } from '../repositories/antiCheatRepository.ts';
import { eventRepository } from '../repositories/eventRepository.ts';

interface ThrottleEntry {
  lastRecordedAt: number;
  burstCount: number;
  windowStart: number;
}

export class AntiCheatService {
  // In-memory throttling map: `${teamId}:${sessionId}:${eventType}` -> ThrottleEntry
  private throttleMap = new Map<string, ThrottleEntry>();

  // Configuration constants
  private readonly DEBOUNCE_MS = 800; // Ignore duplicates within 800ms
  private readonly MAX_EVENTS_PER_MINUTE = 40; // Max events per session per 60s
  private readonly RATE_WINDOW_MS = 60 * 1000;

  /**
   * Reset throttle cache (useful for testing)
   */
  clearThrottleCache() {
    this.throttleMap.clear();
  }

  /**
   * Process and record a client-submitted anti-cheat event.
   * Enforces server-side debouncing and rate limiting.
   */
  async recordClientEvent(params: {
    participantId?: string | null;
    teamId?: string | null;
    sessionId?: string | null;
    challengeId?: string | null;
    eventType: string;
    metadata?: Record<string, any>;
  }): Promise<{
    recorded: boolean;
    throttled?: boolean;
    event?: AntiCheatEventRecord;
    reason?: string;
  }> {
    const validEventTypes: AntiCheatEventType[] = [
      'TAB_HIDDEN',
      'TAB_VISIBLE',
      'WINDOW_BLUR',
      'WINDOW_FOCUS',
      'FULLSCREEN_EXIT',
      'FULLSCREEN_ENTER',
      'VIEWPORT_CHANGE',
      'VIEWPORT_RESIZE',
      'BROWSER_UNSUPPORTED',
      'PAGE_RELOAD',
      'RELOAD',
      'RECONNECT',
      'MULTIPLE_SESSION',
      'MULTI_SESSION_ATTEMPT',
      'SESSION_REJECTED',
      'HEARTBEAT_TIMEOUT',
      'COPY_PASTE_FLAG',
    ];

    if (!validEventTypes.includes(params.eventType as AntiCheatEventType)) {
      return {
        recorded: false,
        reason: `Invalid event type: ${params.eventType}`,
      };
    }

    const eventType = params.eventType as AntiCheatEventType;
    const now = Date.now();
    const entityIdentity = params.participantId || params.teamId || 'unknown';
    const throttleKey = `${entityIdentity}:${params.sessionId || 'nosess'}:${eventType}`;

    // Check rate limiting and debouncing
    const entry = this.throttleMap.get(throttleKey);

    if (entry) {
      // 1. Debounce rapid duplicate events
      if (now - entry.lastRecordedAt < this.DEBOUNCE_MS) {
        return {
          recorded: false,
          throttled: true,
          reason: 'Duplicate event debounced',
        };
      }

      // 2. Sliding window rate limit check
      if (now - entry.windowStart > this.RATE_WINDOW_MS) {
        entry.windowStart = now;
        entry.burstCount = 0;
      }

      if (entry.burstCount >= this.MAX_EVENTS_PER_MINUTE) {
        return {
          recorded: false,
          throttled: true,
          reason: 'Event rate limit exceeded for current session',
        };
      }

      entry.lastRecordedAt = now;
      entry.burstCount++;
    } else {
      this.throttleMap.set(throttleKey, {
        lastRecordedAt: now,
        burstCount: 1,
        windowStart: now,
      });
    }

    // Clean up old throttle entries periodically (if map grows large)
    if (this.throttleMap.size > 5000) {
      const expiry = now - this.RATE_WINDOW_MS * 2;
      for (const [k, v] of this.throttleMap.entries()) {
        if (v.lastRecordedAt < expiry) {
          this.throttleMap.delete(k);
        }
      }
    }

    // Determine appropriate default action (non-punitive for normal focus restoration and viewport changes)
    let actionTaken: AntiCheatAction = 'RECORDED_VIOLATION';
    if (
      eventType === 'TAB_VISIBLE' ||
      eventType === 'WINDOW_FOCUS' ||
      eventType === 'FULLSCREEN_ENTER' ||
      eventType === 'VIEWPORT_CHANGE' ||
      eventType === 'VIEWPORT_RESIZE' ||
      eventType === 'RECONNECT'
    ) {
      actionTaken = 'LOGGED';
    }

    // Sanitize metadata
    const sanitizedMetadata: Record<string, any> = {};
    if (params.metadata && typeof params.metadata === 'object') {
      const allowedKeys = [
        'durationSeconds',
        'durationMs',
        'reason',
        'activeChallengeId',
        'viewportWidth',
        'viewportHeight',
        'screenWidth',
        'screenHeight',
        'devicePixelRatio',
        'userAgent',
        'isFullscreen',
        'visibilityState',
        'hasFocus',
        'timestamp',
      ];
      for (const key of allowedKeys) {
        if (params.metadata[key] !== undefined) {
          sanitizedMetadata[key] = params.metadata[key];
        }
      }
    }

    // Record authoritative event
    const recorded = await antiCheatRepository.recordEvent({
      participantId: params.participantId,
      teamId: params.teamId,
      participantSessionId: params.sessionId,
      challengeId: params.challengeId,
      eventType,
      actionTaken,
      metadata: sanitizedMetadata,
    });

    return {
      recorded: true,
      event: recorded,
    };
  }

  /**
   * Helper to record server-originated integrity violations (e.g. multi-session login attempts).
   */
  async recordServerSecurityEvent(params: {
    participantId?: string | null;
    teamId?: string | null;
    sessionId?: string | null;
    eventType: AntiCheatEventType;
    actionTaken?: AntiCheatAction;
    metadata?: Record<string, any>;
  }): Promise<AntiCheatEventRecord> {
    const recorded = await antiCheatRepository.recordEvent({
      participantId: params.participantId,
      teamId: params.teamId,
      participantSessionId: params.sessionId,
      eventType: params.eventType,
      actionTaken: params.actionTaken || 'RECORDED_VIOLATION',
      metadata: params.metadata || {},
    });

    return recorded;
  }

  /**
   * Reset throttle map (useful for test environments or cache clearing).
   */
  clearThrottleMap(): void {
    this.throttleMap.clear();
  }
}

export const antiCheatService = new AntiCheatService();

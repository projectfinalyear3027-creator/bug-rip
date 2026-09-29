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

  // In-memory registry of verified participant fullscreen states
  private participantFullscreenMap = new Map<string, boolean>();

  // Configuration constants
  private readonly DEBOUNCE_MS = 800; // Ignore duplicates within 800ms
  private readonly MAX_EVENTS_PER_MINUTE = 40; // Max events per session per 60s
  private readonly RATE_WINDOW_MS = 60 * 1000;

  /**
   * Reset throttle cache (useful for testing)
   */
  clearThrottleCache() {
    this.throttleMap.clear();
    this.participantFullscreenMap.clear();
  }

  /**
   * Sets the authoritative arena fullscreen state for a participant/team/session.
   */
  setParticipantFullscreen(
    identity: { participantId?: string | null; teamId?: string | null; sessionId?: string | null },
    isFullscreen: boolean
  ): void {
    if (identity.sessionId) {
      this.participantFullscreenMap.set(`sess:${identity.sessionId}`, isFullscreen);
    }
    if (identity.participantId) {
      this.participantFullscreenMap.set(`part:${identity.participantId}`, isFullscreen);
    }
    if (identity.teamId) {
      this.participantFullscreenMap.set(`team:${identity.teamId}`, isFullscreen);
    }
  }

  /**
   * Directly sets the authoritative arena fullscreen state for any identifier (teamId or participantId).
   */
  setParticipantFullscreenDirect(entityId: string, isFullscreen: boolean): void {
    this.participantFullscreenMap.set(`part:${entityId}`, isFullscreen);
    this.participantFullscreenMap.set(`team:${entityId}`, isFullscreen);
    this.participantFullscreenMap.set(`sess:${entityId}`, isFullscreen);
  }

  /**
   * Checks whether the participant is currently in verified arena fullscreen.
   * A participant in a RUNNING match may execute or submit ONLY while verified in fullscreen.
   */
  isParticipantInFullscreen(
    participantId?: string | null,
    teamId?: string | null,
    sessionId?: string | null
  ): boolean {
    if (sessionId && this.participantFullscreenMap.has(`sess:${sessionId}`)) {
      return Boolean(this.participantFullscreenMap.get(`sess:${sessionId}`));
    }
    if (participantId && this.participantFullscreenMap.has(`part:${participantId}`)) {
      return Boolean(this.participantFullscreenMap.get(`part:${participantId}`));
    }
    if (teamId && this.participantFullscreenMap.has(`team:${teamId}`)) {
      return Boolean(this.participantFullscreenMap.get(`team:${teamId}`));
    }
    // Default to false: fullscreen must be confirmed via FULLSCREEN_ENTER
    return false;
  }

  /**
   * Clear all stored fullscreen states (for testing and isolation).
   */
  clearFullscreenMap(): void {
    this.participantFullscreenMap.clear();
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
    matchNumber?: number;
    matchId?: string | null;
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
      'ARENA_ROUTE_BLOCKED',
      'LEAVE_ATTEMPT',
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

    // Authoritative Fullscreen State Tracking: Update verified fullscreen gate state
    if (eventType === 'FULLSCREEN_ENTER') {
      this.setParticipantFullscreen(
        {
          participantId: params.participantId,
          teamId: params.teamId,
          sessionId: params.sessionId,
        },
        true
      );
    } else if (eventType === 'FULLSCREEN_EXIT') {
      this.setParticipantFullscreen(
        {
          participantId: params.participantId,
          teamId: params.teamId,
          sessionId: params.sessionId,
        },
        false
      );
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
      matchNumber: params.matchNumber,
      matchId: params.matchId,
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
   * Reset throttle map and fullscreen registry (useful for test environments or cache clearing).
   */
  clearThrottleMap(): void {
    this.throttleMap.clear();
    this.clearFullscreenMap();
  }
}

export const antiCheatService = new AntiCheatService();

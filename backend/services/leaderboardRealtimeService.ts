/**
 * BUG RIP - Leaderboard Realtime Service (Fragment 11)
 * Manages public SSE connections for /live auditorium and projector display.
 * 
 * STRICT ARCHITECTURAL BOUNDARY:
 * - Public stream is dedicated exclusively to public spectators/projectors.
 * - COMPLETELY ISOLATED from private participant team SSE streams.
 * - NEVER emits team codes, session tokens, member emails, source code, flags, or private logs.
 * - Broadcasts only sanitized public leaderboard data and authoritative event state.
 */

import { Response } from 'express';
import { eventService } from './eventService.ts';

export interface PublicLeaderboardRow {
  rank: number;
  teamName: string;
  connectedMembers: number;
  registeredMembers: number;
  problemsSolved: number;
  score: number;
  lastSolveTimestamp: string;
}

export interface PublicEventStatusPayload {
  status: 'NOT_STARTED' | 'RUNNING' | 'PAUSED' | 'ENDED';
  remainingSeconds: number;
  elapsedSeconds: number;
  durationMinutes: number;
  serverTime: string;
  message?: string;
  timestamp: string;
}

export class LeaderboardRealtimeService {
  private clients: Set<Response> = new Set();
  private keepAliveTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.startKeepAlive();
  }

  private startKeepAlive() {
    if (this.keepAliveTimer) return;
    this.keepAliveTimer = setInterval(() => {
      this.sendKeepAlive();
    }, 15000);

    // Unref so keep-alive timer does not block test teardown or process exit
    if (this.keepAliveTimer.unref) {
      this.keepAliveTimer.unref();
    }
  }

  /**
   * Register a new public /live spectator client
   */
  public registerClient(res: Response) {
    this.clients.add(res);

    res.on('close', () => {
      this.clients.delete(res);
    });
  }

  /**
   * Number of active /live stream listeners
   */
  public getConnectedClientCount(): number {
    return this.clients.size;
  }

  /**
   * Periodic keep-alive comment to prevent intermediate proxy timeouts
   */
  private sendKeepAlive() {
    for (const client of this.clients) {
      try {
        client.write(': ping\n\n');
      } catch {
        this.clients.delete(client);
      }
    }
  }

  /**
   * Low-level SSE message dispatch
   */
  public broadcast(event: string, data: any) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(payload);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  /**
   * Broadcast authoritative fresh leaderboard to all connected /live clients.
   * Triggered immediately after a challenge completion transaction commits.
   */
  public async notifyLeaderboardUpdated() {
    try {
      const publicLeaderboard = await eventService.getPublicLeaderboard();
      const eventStatus = await eventService.getEventStatus();

      this.broadcast('leaderboard.updated', {
        timestamp: new Date().toISOString(),
        event: {
          status: eventStatus.status,
          remainingSeconds: eventStatus.remainingSeconds,
          elapsedSeconds: eventStatus.elapsedSeconds,
          durationMinutes: eventStatus.durationMinutes,
          serverTime: eventStatus.serverTime,
        },
        leaderboard: publicLeaderboard,
      });
    } catch (err) {
      console.error('[LeaderboardRealtimeService] Error broadcasting leaderboard update:', err);
    }
  }

  /**
   * Broadcast authoritative event lifecycle transitions (START, PAUSE, RESUME, END)
   */
  public broadcastEventStatusChanged(statusData: {
    status: 'NOT_STARTED' | 'RUNNING' | 'PAUSED' | 'ENDED';
    remainingSeconds?: number;
    elapsedSeconds?: number;
    durationMinutes?: number;
    message?: string;
    timestamp: string;
  }) {
    this.broadcast('event.status.changed', statusData);
  }

  /**
   * Reset helper for testing environments
   */
  public resetForTesting() {
    for (const client of this.clients) {
      try {
        client.end();
      } catch {}
    }
    this.clients.clear();
  }
}

export const leaderboardRealtimeService = new LeaderboardRealtimeService();

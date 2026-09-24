/**
 * BUG RIP - Event Service
 * Manages competition rules, difficulty progression thresholds, authoritative timer, and leaderboard state.
 */

import { eventRepository } from '../repositories/eventRepository.ts';
import { challengeRepository } from '../repositories/challengeRepository.ts';
import { teamChallengeRepository } from '../repositories/teamChallengeRepository.ts';
import { teamRepository } from '../repositories/teamRepository.ts';
import { progressionService } from './progressionService.ts';
import { leaderboardRealtimeService } from './leaderboardRealtimeService.ts';
import { AppError } from '../middleware/errorHandler.ts';

export interface AuthoritativeEventStatus {
  status: 'NOT_STARTED' | 'RUNNING' | 'PAUSED' | 'ENDED';
  eventName: string;
  durationMinutes: number;
  totalSeconds: number;
  remainingSeconds: number;
  elapsedSeconds: number;
  startedAt: string | null;
  endedAt: string | null;
  pausedAt: string | null;
  totalPausedDurationSeconds: number;
  scheduledEndTime: string | null;
  serverTime: string;
  isActionAllowed: boolean;
  progressionMode: string;
  minTeamMembers: number;
  maxTeamMembers: number;
  liveScoreboardEnabled: boolean;
  currentMatchNumber: number;
  currentMatchId?: string | null;
}

export class EventService {
  /**
   * Get current event state & authoritative timer info.
   * Enforces automatic competition expiration at 0 seconds.
   */
  async getEventStatus(): Promise<AuthoritativeEventStatus> {
    const settings = await eventRepository.getEventSettings();
    if (!settings) {
      throw new AppError('Event settings not initialized.', 500, 'SETTINGS_MISSING');
    }

    const serverTime = new Date();
    const durationMinutes = settings.durationMinutes || 60;
    const totalSeconds = durationMinutes * 60;
    const totalPausedDurationSeconds = settings.totalPausedDurationSeconds || 0;

    let status = settings.status as 'NOT_STARTED' | 'RUNNING' | 'PAUSED' | 'ENDED';
    let remainingSeconds = totalSeconds;
    let elapsedSeconds = 0;
    let isActionAllowed = false;
    let scheduledEndTime: Date | null = null;
    let startedAtStr: string | null = settings.startedAt ? new Date(settings.startedAt).toISOString() : null;
    let pausedAtStr: string | null = settings.pausedAt ? new Date(settings.pausedAt).toISOString() : null;
    let endedAtStr: string | null = settings.endedAt ? new Date(settings.endedAt).toISOString() : null;

    if (status === 'NOT_STARTED') {
      remainingSeconds = totalSeconds;
      elapsedSeconds = 0;
      isActionAllowed = false;
      scheduledEndTime = null;
    } else if (status === 'RUNNING' && settings.startedAt) {
      const startedAt = new Date(settings.startedAt);
      // Scheduled end is start + total duration + accumulated pause duration
      scheduledEndTime = new Date(
        startedAt.getTime() + (totalSeconds + totalPausedDurationSeconds) * 1000
      );

      // Active elapsed time excludes paused periods
      const rawElapsed = Math.floor((serverTime.getTime() - startedAt.getTime()) / 1000);
      elapsedSeconds = Math.max(0, rawElapsed - totalPausedDurationSeconds);
      remainingSeconds = Math.max(0, totalSeconds - elapsedSeconds);

      // AUTOMATIC TIMEOUT CHECK:
      // If remaining time reached zero, server automatically transitions to ENDED
      if (remainingSeconds <= 0) {
        status = 'ENDED';
        remainingSeconds = 0;
        elapsedSeconds = totalSeconds;
        isActionAllowed = false;
        endedAtStr = scheduledEndTime.toISOString();

        // Atomically commit auto-end transition to database
        await eventRepository.autoEndEvent(
          scheduledEndTime,
          'Automatic competition conclusion: authoritative 60-minute duration elapsed.'
        );

        try {
          leaderboardRealtimeService.broadcastEventStatusChanged({
            status: 'ENDED',
            remainingSeconds: 0,
            elapsedSeconds: totalSeconds,
            durationMinutes,
            message: 'Automatic competition conclusion: authoritative 60-minute duration elapsed.',
            timestamp: new Date().toISOString(),
          });
          leaderboardRealtimeService.notifyLeaderboardUpdated();
        } catch {}
      } else {
        isActionAllowed = true;
      }
    } else if (status === 'PAUSED' && settings.startedAt && settings.pausedAt) {
      const startedAt = new Date(settings.startedAt);
      const pausedAt = new Date(settings.pausedAt);

      // In PAUSED state, elapsed seconds are frozen at the exact time pausedAt was recorded
      const rawElapsed = Math.floor((pausedAt.getTime() - startedAt.getTime()) / 1000);
      elapsedSeconds = Math.max(0, rawElapsed - totalPausedDurationSeconds);
      remainingSeconds = Math.max(0, totalSeconds - elapsedSeconds);
      isActionAllowed = false;

      // Scheduled end is pushed back by the current ongoing pause duration
      const currentPauseDuration = Math.max(0, Math.floor((serverTime.getTime() - pausedAt.getTime()) / 1000));
      scheduledEndTime = new Date(
        startedAt.getTime() + (totalSeconds + totalPausedDurationSeconds + currentPauseDuration) * 1000
      );
    } else if (status === 'ENDED') {
      remainingSeconds = 0;
      elapsedSeconds = totalSeconds;
      isActionAllowed = false;
    }

    return {
      status,
      eventName: settings.eventName,
      durationMinutes,
      totalSeconds,
      remainingSeconds,
      elapsedSeconds,
      startedAt: startedAtStr,
      endedAt: endedAtStr,
      pausedAt: pausedAtStr,
      totalPausedDurationSeconds,
      scheduledEndTime: scheduledEndTime ? scheduledEndTime.toISOString() : null,
      serverTime: serverTime.toISOString(),
      isActionAllowed,
      progressionMode: settings.progressionMode,
      minTeamMembers: settings.minTeamMembers,
      maxTeamMembers: settings.maxTeamMembers,
      liveScoreboardEnabled: settings.liveScoreboardEnabled,
      currentMatchNumber: settings.currentMatchNumber || 1,
      currentMatchId: settings.currentMatchId || null,
    };
  }

  /**
   * Universal check for challenge actions, Java execution, flag submissions, and scoring.
   * Centralizes all competition state boundary checks.
   */
  async isCompetitionActionAllowed(teamId?: string): Promise<{
    allowed: boolean;
    status: 'NOT_STARTED' | 'RUNNING' | 'PAUSED' | 'ENDED';
    reason?: string;
    remainingSeconds: number;
  }> {
    const eventState = await this.getEventStatus();

    if (eventState.status === 'NOT_STARTED') {
      return {
        allowed: false,
        status: 'NOT_STARTED',
        remainingSeconds: eventState.remainingSeconds,
        reason: 'Competition has not started yet. Participants must wait in the waiting room.',
      };
    }

    if (eventState.status === 'PAUSED') {
      return {
        allowed: false,
        status: 'PAUSED',
        remainingSeconds: eventState.remainingSeconds,
        reason: 'Competition is currently paused by the organizer. Submissions are temporarily suspended.',
      };
    }

    if (eventState.status === 'ENDED') {
      return {
        allowed: false,
        status: 'ENDED',
        remainingSeconds: 0,
        reason: 'Competition has ended. No further submissions or progress are accepted.',
      };
    }

    if (teamId) {
      const team = await teamRepository.getTeamById(teamId);
      if (!team) {
        return {
          allowed: false,
          status: 'RUNNING',
          remainingSeconds: eventState.remainingSeconds,
          reason: 'Team not found in registry.',
        };
      }
      if (team.status !== 'ACTIVE') {
        return {
          allowed: false,
          status: 'RUNNING',
          remainingSeconds: eventState.remainingSeconds,
          reason: `Team is currently ${team.status}. Access denied.`,
        };
      }
    }

    return {
      allowed: true,
      status: 'RUNNING',
      remainingSeconds: eventState.remainingSeconds,
    };
  }

  /**
   * Determine available rounds & challenges for a team based on solve count
   */
  async getTeamAvailableChallenges(teamId: string) {
    const settings = await eventRepository.getEventSettings();
    if (!settings || settings.status === 'NOT_STARTED') {
      throw new AppError(
        'Challenges cannot be accessed before the competition has started.',
        403,
        'EVENT_NOT_STARTED'
      );
    }

    const progression = await progressionService.getTeamProgression(teamId);
    return progression;
  }

  /**
   * Get Authoritative Leaderboard (includes teamId for internal/admin use)
   */
  async getAuthoritativeLeaderboard() {
    return await eventRepository.getLeaderboard();
  }

  /**
   * Get Sanitized Public Leaderboard for /live auditorium and projector display.
   * Strips all internal identifiers, tokens, credentials, and sensitive fields.
   */
  async getPublicLeaderboard() {
    const raw = await eventRepository.getLeaderboard();
    return raw.map((entry) => ({
      rank: entry.rank,
      participantName: (entry as any).participantName || entry.teamName,
      teamName: entry.teamName || (entry as any).participantName,
      connectedMembers: entry.connectedMemberCount,
      registeredMembers: entry.registeredMemberCount,
      problemsSolved: entry.problemsSolved,
      score: entry.score,
      lastSolveTimestamp: entry.lastSolveTimestamp,
    }));
  }
}

export const eventService = new EventService();

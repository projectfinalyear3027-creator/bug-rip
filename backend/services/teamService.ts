/**
 * BUG RIP - Team Business Logic Service
 * Enforces:
 * 1. 1-3 Member Team Unit Constraint
 * 2. Strict CSV team credentials verification
 * 3. Concurrent session enforcement (1 for 1-member, 2 for 2-member, 3 for 3-member)
 */

import crypto from 'crypto';
import { teamRepository } from '../repositories/teamRepository.ts';
import { AppError } from '../middleware/errorHandler.ts';

export class TeamService {
  /**
   * Authenticate team by name and CSV-imported secret code
   */
  async authenticateTeam(teamName: string, teamCode: string, userAgent?: string, ipAddress?: string) {
    if (!teamName || !teamCode) {
      throw new AppError('Team name and team code are required.', 400, 'MISSING_CREDENTIALS');
    }

    const team = await teamRepository.verifyCredentials(teamName, teamCode);
    if (!team) {
      throw new AppError(
        'Invalid team credentials. Ensure team name and CSV secret code match exactly.',
        401,
        'INVALID_CREDENTIALS'
      );
    }

    if (team.status !== 'ACTIVE') {
      throw new AppError(
        `Team cannot log in because its status is ${team.status}.`,
        403,
        'TEAM_INACTIVE'
      );
    }

    // Check active session limits
    // 1-member team -> max 1 session
    // 2-member team -> max 2 sessions
    // 3-member team -> max 3 sessions
    const activeSessions = await teamRepository.getActiveSessionCount(team.id);
    const maxAllowedSessions = team.registeredMemberCount;

    if (activeSessions >= maxAllowedSessions) {
      throw new AppError(
        `Concurrent session limit reached (${activeSessions}/${maxAllowedSessions} active). If a prior session disconnected, please wait for stale session expiry or ask an organizer.`,
        409,
        'SESSION_LIMIT_EXCEEDED'
      );
    }

    // Generate secure session token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const session = await teamRepository.createSession({
      teamId: team.id,
      sessionTokenHash: tokenHash,
      userAgent,
      ipAddress,
    });

    const members = await teamRepository.getTeamParticipants(team.id);

    return {
      sessionToken: rawToken,
      sessionId: session.id,
      team: {
        id: team.id,
        teamName: team.teamName,
        teamCode: team.teamCode,
        registeredMemberCount: team.registeredMemberCount,
        members: members.map((m) => ({
          id: m.id,
          name: m.name,
          college: m.college,
        })),
      },
    };
  }

  /**
   * Get team details with active session check
   */
  async getTeamDetails(teamId: string) {
    const team = await teamRepository.findById(teamId);
    if (!team) {
      throw new AppError('Team not found.', 404, 'TEAM_NOT_FOUND');
    }

    const members = await teamRepository.getTeamParticipants(teamId);
    const activeSessions = await teamRepository.getActiveSessionCount(teamId);

    return {
      id: team.id,
      teamName: team.teamName,
      teamCode: team.teamCode,
      status: team.status,
      registeredMemberCount: team.registeredMemberCount,
      connectedMemberCount: activeSessions,
      members,
    };
  }

  /**
   * Add a member to a team (up to 3 members maximum).
   */
  async addMember(
    teamId: string,
    participantData: {
      name: string;
      email?: string;
      phone?: string;
      college?: string;
      externalParticipantId?: string;
    }
  ) {
    if (!participantData.name || !participantData.name.trim()) {
      throw new AppError('Participant name is required.', 400, 'INVALID_NAME');
    }

    try {
      return await teamRepository.addParticipantToTeam(teamId, participantData);
    } catch (err: any) {
      if (err.message?.includes('MAX_TEAM_SIZE_EXCEEDED')) {
        throw new AppError(
          'Maximum team size reached (3 members). Adding a 4th member is strictly rejected.',
          400,
          'MAX_TEAM_SIZE_EXCEEDED'
        );
      }
      if (err.message === 'TEAM_NOT_FOUND') {
        throw new AppError('Team not found.', 404, 'TEAM_NOT_FOUND');
      }
      throw err;
    }
  }

  /**
   * Remove a member from a team (down to 1 member minimum).
   */
  async removeMember(teamId: string, participantId: string) {
    try {
      return await teamRepository.removeParticipantFromTeam(teamId, participantId);
    } catch (err: any) {
      if (err.message?.includes('MIN_TEAM_SIZE_VIOLATION')) {
        throw new AppError(
          'Cannot remove member: Teams must contain at least 1 member (0-member teams are strictly prohibited).',
          400,
          'MIN_TEAM_SIZE_VIOLATION'
        );
      }
      if (err.message?.includes('MEMBER_NOT_FOUND')) {
        throw new AppError('Participant is not a member of this team.', 404, 'MEMBER_NOT_FOUND');
      }
      if (err.message === 'TEAM_NOT_FOUND') {
        throw new AppError('Team not found.', 404, 'TEAM_NOT_FOUND');
      }
      throw err;
    }
  }
}

export const teamService = new TeamService();

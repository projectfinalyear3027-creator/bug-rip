/**
 * BUG RIP - Team Repository
 * Handles teams, participants, team members, and concurrent sessions with full PostgreSQL constraints.
 */

import { eq, and, sql, count, gt, lte } from 'drizzle-orm';
import { db } from '../../src/db/index.ts';
import {
  teams,
  participants,
  teamMembers,
  sessions,
  auditLogs,
} from '../../src/db/schema.ts';
import { teamRealtimeService } from '../services/teamRealtimeService.ts';

export class TeamRepository {
  /**
   * Look up team by ID
   */
  async findById(teamId: string) {
    const result = await db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);
    if (result[0]) return result[0];

    // Fallback: Check participants table for solo participants
    const part = await db
      .select()
      .from(participants)
      .where(eq(participants.id, teamId))
      .limit(1);
    if (part[0]) {
      return {
        id: part[0].id,
        teamName: part[0].name,
        teamCode: part[0].participantCode,
        status: part[0].status,
        registeredMemberCount: 1,
        activeMemberCount: 1,
        createdAt: part[0].createdAt,
        updatedAt: part[0].updatedAt,
      } as any;
    }

    return null;
  }

  async getTeamById(teamId: string) {
    return this.findById(teamId);
  }

  /**
   * Look up team by unique CSV-imported team code
   */
  async findByCode(teamCode: string) {
    const result = await db
      .select()
      .from(teams)
      .where(eq(teams.teamCode, teamCode.trim()))
      .limit(1);
    return result[0] || null;
  }

  async getTeamByCode(teamCode: string) {
    return this.findByCode(teamCode);
  }

  /**
   * Verify team credentials:
   * Case-insensitive & trimmed comparison on teamName, exact on teamCode
   */
  async verifyCredentials(teamName: string, teamCode: string) {
    const cleanName = teamName.trim().toLowerCase();
    const cleanCode = teamCode.trim();

    const result = await db
      .select()
      .from(teams)
      .where(
        and(
          sql`LOWER(TRIM(${teams.teamName})) = ${cleanName}`,
          eq(teams.teamCode, cleanCode)
        )
      )
      .limit(1);

    return result[0] || null;
  }

  /**
   * Get all registered participants for a team
   */
  async getTeamParticipants(teamId: string) {
    return await db
      .select({
        id: participants.id,
        externalParticipantId: participants.externalParticipantId,
        name: participants.name,
        email: participants.email,
        phone: participants.phone,
        college: participants.college,
        createdAt: participants.createdAt,
      })
      .from(teamMembers)
      .innerJoin(participants, eq(teamMembers.participantId, participants.id))
      .where(eq(teamMembers.teamId, teamId));
  }

  /**
   * Stale session recovery: marks inactive sessions as EXPIRED
   * Cleans up stale sessions without deleting historical records
   */
  async cleanupStaleSessions(teamId?: string): Promise<number> {
    const cutoff = new Date(Date.now() - 3 * 60 * 1000);
    const conditions = [
      eq(sessions.status, 'ACTIVE'),
      lte(sessions.lastHeartbeatAt, cutoff),
    ];
    if (teamId) {
      conditions.push(eq(sessions.teamId, teamId));
    }

    const updated = await db
      .update(sessions)
      .set({
        status: 'EXPIRED',
        disconnectedAt: sql`NOW()`,
        updatedAt: sql`NOW()`,
      })
      .where(and(...conditions))
      .returning({ id: sessions.id, teamId: sessions.teamId });

    if (updated.length > 0) {
      for (const row of updated) {
        await teamRealtimeService.unregisterSession(row.id);
        try {
          await db.insert(auditLogs).values({
            action: 'PARTICIPANT_SESSION_EXPIRED',
            targetType: 'SESSION',
            targetId: row.id,
            reason: 'Session expired after missing heartbeat threshold (3 minutes).',
            metadata: { teamId: row.teamId },
          });
        } catch {
          // Continue if logging fails
        }
      }
    }

    return updated.length;
  }

  /**
   * Look up participant by ID
   */
  async findParticipantById(participantId: string) {
    const result = await db
      .select()
      .from(participants)
      .where(eq(participants.id, participantId))
      .limit(1);
    return result[0] || null;
  }

  /**
   * Look up participant by code (participantCode or externalParticipantId)
   */
  async findParticipantByCode(code: string) {
    const cleanCode = code.trim().toUpperCase();
    const result = await db
      .select()
      .from(participants)
      .where(
        sql`UPPER(TRIM(${participants.participantCode})) = ${cleanCode} OR UPPER(TRIM(COALESCE(${participants.externalParticipantId}, ''))) = ${cleanCode}`
      )
      .limit(1);
    return result[0] || null;
  }

  /**
   * Verify participant credentials:
   * Accepts participantCode, and optional name or email confirmation
   */
  async verifyParticipantCredentials(code: string, nameOrEmail?: string) {
    const cleanCode = code.trim().toUpperCase();
    
    // First try by participantCode or externalParticipantId
    let participant = await this.findParticipantByCode(cleanCode);

    // If not found directly, check teams by teamCode (for backward compatibility)
    if (!participant) {
      const team = await this.findByCode(cleanCode);
      if (team) {
        // Find participant associated with this team
        const members = await this.getTeamParticipants(team.id);
        if (members.length > 0) {
          participant = await this.findParticipantById(members[0].id);
        }
      }
    }

    // If still not found and nameOrEmail is supplied, try name match
    if (!participant && nameOrEmail) {
      const cleanName = nameOrEmail.trim().toLowerCase();
      const byName = await db
        .select()
        .from(participants)
        .where(
          sql`LOWER(TRIM(${participants.name})) = ${cleanName} OR LOWER(TRIM(COALESCE(${participants.email}, ''))) = ${cleanName}`
        )
        .limit(1);
      if (byName.length > 0) {
        participant = byName[0];
      }
    }

    if (!participant) return null;

    // Optional name/email secondary verification
    if (nameOrEmail) {
      const cleanInput = nameOrEmail.trim().toLowerCase();
      const pName = (participant.name || '').trim().toLowerCase();
      const pEmail = (participant.email || '').trim().toLowerCase();
      if (cleanInput !== pName && cleanInput !== pEmail) {
        // If neither name nor email matched, reject
        return null;
      }
    }

    return participant;
  }

  /**
   * Get active connected sessions count for an individual participant
   * Exactly 1 session allowed per participant.
   */
  async getActiveParticipantSessionCount(participantId: string): Promise<number> {
    await this.cleanupStaleSessions();

    const activeSessions = await db
      .select({ val: count() })
      .from(sessions)
      .where(
        and(
          eq(sessions.participantId, participantId),
          eq(sessions.status, 'ACTIVE')
        )
      );

    return Number(activeSessions[0]?.val || 0);
  }

  /**
   * Look up active session by sha256 token hash with participant resolution
   */
  async findSessionByTokenHash(tokenHash: string) {
    const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000);
    const result = await db
      .select({
        session: sessions,
        team: teams,
      })
      .from(sessions)
      .leftJoin(teams, eq(sessions.teamId, teams.id))
      .where(
        and(
          eq(sessions.sessionTokenHash, tokenHash),
          eq(sessions.status, 'ACTIVE'),
          gt(sessions.lastHeartbeatAt, eightHoursAgo)
        )
      )
      .limit(1);

    if (!result[0]) return null;

    const session = result[0].session;
    let team = result[0].team;

    // Resolve participant
    let participant: any = null;
    if (session.participantId) {
      participant = await this.findParticipantById(session.participantId);
    } else if (team?.id) {
      const members = await this.getTeamParticipants(team.id);
      if (members.length > 0) {
        participant = members[0];
      }
    }

    if (!participant && team) {
      // Fallback synthesis
      participant = {
        id: team.id,
        name: team.teamName,
        participantCode: team.teamCode,
        college: null,
        email: null,
        status: team.status,
      };
    }

    // Ensure team object exists even if session was created purely with participantId
    if (!team && participant) {
      team = {
        id: participant.id,
        teamName: participant.name,
        teamCode: participant.participantCode || 'SOLO',
        registeredMemberCount: 1,
        status: participant.status || 'ACTIVE',
        externalTeamId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any;
    }

    return {
      session,
      team: team!,
      participant,
    };
  }

  /**
   * Update session heartbeat timestamp
   */
  async updateSessionHeartbeat(sessionId: string) {
    teamRealtimeService.recordHeartbeat(sessionId);
    await db
      .update(sessions)
      .set({
        lastHeartbeatAt: sql`NOW()`,
        updatedAt: sql`NOW()`,
      })
      .where(eq(sessions.id, sessionId));
  }

  /**
   * Terminate session on participant logout
   */
  async terminateSession(sessionId: string) {
    await teamRealtimeService.unregisterSession(sessionId);
    await db
      .update(sessions)
      .set({
        status: 'TERMINATED',
        disconnectedAt: sql`NOW()`,
        updatedAt: sql`NOW()`,
      })
      .where(eq(sessions.id, sessionId));
  }

  /**
   * Allocate next available participant from team members list
   */
  async getNextAvailableParticipant(teamId: string): Promise<string | null> {
    const members = await this.getTeamParticipants(teamId);
    if (members.length === 0) return null;

    const available = members.find((m) => !teamRealtimeService.isParticipantConnected(m.id));
    return available ? available.id : members[0].id;
  }

  /**
   * Get active connected sessions count for concurrency control
   */
  async getActiveSessionCount(teamId: string): Promise<number> {
    // Clean up stale sessions in DB first
    await this.cleanupStaleSessions(teamId);

    // Active session count authoritative from database
    const activeSessions = await db
      .select({ val: count() })
      .from(sessions)
      .where(and(eq(sessions.teamId, teamId), eq(sessions.status, 'ACTIVE')));

    return Number(activeSessions[0]?.val || 0);
  }

  /**
   * Create a new session for a participant (or legacy team member)
   */
  async createSession(params: {
    teamId?: string;
    participantId?: string;
    sessionTokenHash: string;
    userAgent?: string;
    ipAddress?: string;
  }) {
    const created = await db
      .insert(sessions)
      .values({
        teamId: params.teamId,
        participantId: params.participantId,
        sessionTokenHash: params.sessionTokenHash,
        status: 'ACTIVE',
        userAgent: params.userAgent,
        ipAddress: params.ipAddress,
      })
      .returning();

    const newSession = created[0];
    if (newSession) {
      teamRealtimeService.registerSessionFallback(
        newSession.id,
        params.teamId,
        params.participantId
      );
    }

    return newSession;
  }

  /**
   * Get total registration counts for teams, participants, and memberships.
   * Used for fresh deployment verification and diagnostic health monitoring.
   */
  async getRegistrationCounts(): Promise<{
    teams: number;
    participants: number;
    teamMembers: number;
  }> {
    const [teamCountRes, partCountRes, memberCountRes] = await Promise.all([
      db.select({ count: count() }).from(teams).where(eq(teams.status, 'ACTIVE')),
      db.select({ count: count() }).from(participants).where(eq(participants.status, 'ACTIVE')),
      db.select({ count: count() }).from(teamMembers),
    ]);

    return {
      teams: Number(teamCountRes[0]?.count || 0),
      participants: Number(partCountRes[0]?.count || 0),
      teamMembers: Number(memberCountRes[0]?.count || 0),
    };
  }

  /**
   * List all teams (for admin/surveillance)
   */
  async listTeams(limit: number = 50, offset: number = 0) {
    return await db
      .select()
      .from(teams)
      .limit(limit)
      .offset(offset);
  }

  /**
   * Concurrently add a participant to a team.
   * Atomic protection: locks the team row (FOR UPDATE) inside a transaction,
   * counts existing members in team_members:
   * - If count >= 3: throws an error (4 or more participants rejected)
   * - Creates the participant
   * - Inserts into team_members
   * - Updates teams.registered_member_count = newCount
   * - Returns the new participant and updated member count
   */
  async addParticipantToTeam(
    teamId: string,
    participantData: {
      name: string;
      email?: string;
      phone?: string;
      college?: string;
      externalParticipantId?: string;
    }
  ) {
    return await db.transaction(async (tx) => {
      // Lock the team row to prevent concurrent race condition
      const teamRow = await tx
        .select()
        .from(teams)
        .where(eq(teams.id, teamId))
        .for('update');

      if (teamRow.length === 0) {
        throw new Error('TEAM_NOT_FOUND');
      }

      // Count current members
      const currentMembers = await tx
        .select({ count: count() })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, teamId));

      const currentCount = Number(currentMembers[0]?.count || 0);

      if (currentCount >= 3) {
        throw new Error('MAX_TEAM_SIZE_EXCEEDED: Team already has the maximum of 3 members. Adding a 4th member is strictly rejected.');
      }

      const [newParticipant] = await tx
        .insert(participants)
        .values({
          name: participantData.name.trim(),
          email: participantData.email?.trim() || null,
          phone: participantData.phone?.trim() || null,
          college: participantData.college?.trim() || null,
          externalParticipantId: participantData.externalParticipantId?.trim() || null,
        })
        .returning();

      await tx.insert(teamMembers).values({
        teamId,
        participantId: newParticipant.id,
      });

      const newMemberCount = currentCount + 1;
      await tx
        .update(teams)
        .set({
          registeredMemberCount: newMemberCount,
          updatedAt: new Date(),
        })
        .where(eq(teams.id, teamId));

      return {
        participant: newParticipant,
        registeredMemberCount: newMemberCount,
      };
    });
  }

  /**
   * Concurrently remove a participant from a team.
   * Enforces minimum team size of 1 member (a team cannot have 0 members).
   */
  async removeParticipantFromTeam(teamId: string, participantId: string) {
    return await db.transaction(async (tx) => {
      const teamRow = await tx
        .select()
        .from(teams)
        .where(eq(teams.id, teamId))
        .for('update');

      if (teamRow.length === 0) {
        throw new Error('TEAM_NOT_FOUND');
      }

      const currentMembers = await tx
        .select({ count: count() })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, teamId));

      const currentCount = Number(currentMembers[0]?.count || 0);

      if (currentCount <= 1) {
        throw new Error('MIN_TEAM_SIZE_VIOLATION: Team has 1 member. Removing the last member is rejected; teams must have at least 1 member.');
      }

      const existingMember = await tx
        .select()
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.participantId, participantId)));

      if (existingMember.length === 0) {
        throw new Error('MEMBER_NOT_FOUND: Participant is not a member of this team.');
      }

      await tx
        .delete(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.participantId, participantId)));

      await tx.delete(participants).where(eq(participants.id, participantId));

      const newMemberCount = currentCount - 1;
      await tx
        .update(teams)
        .set({
          registeredMemberCount: newMemberCount,
          updatedAt: new Date(),
        })
        .where(eq(teams.id, teamId));

      return {
        success: true,
        registeredMemberCount: newMemberCount,
      };
    });
  }
}

export const teamRepository = new TeamRepository();

/**
 * BUG RIP - Test-Only Fixtures Helper
 * 
 * Used strictly within unit tests to populate temporary test teams in isolated test databases.
 * NEVER executed in production or during normal application startup.
 */

import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.ts';
import {
  teams,
  participants,
  teamMembers,
  sessions,
  teamChallenges,
  teamUnlockedRounds,
  progressionOverrides,
} from '../../src/db/schema.ts';

export async function seedTestTeams(): Promise<void> {
  // Team Alpha (2 members: Arun and Ravi)
  const existingAlpha = await db
    .select()
    .from(teams)
    .where(eq(teams.teamCode, 'DEV-ALPHA-001'))
    .limit(1);

  let teamAlphaId: string;
  if (existingAlpha.length > 0) {
    teamAlphaId = existingAlpha[0].id;
  } else {
    const insAlpha = await db
      .insert(teams)
      .values({
        teamName: 'Development Team Alpha',
        teamCode: 'DEV-ALPHA-001',
        externalTeamId: 'EXT-TEAM-001',
        registeredMemberCount: 2,
        status: 'ACTIVE',
      })
      .returning({ id: teams.id });
    teamAlphaId = insAlpha[0].id;

    const p1 = await db
      .insert(participants)
      .values({
        externalParticipantId: 'P-DEV-001',
        name: 'Arun Kumar',
        email: 'arun.dev@example.com',
        phone: '+91-9876543210',
        college: 'National Institute of Technology',
      })
      .onConflictDoNothing({ target: participants.externalParticipantId })
      .returning({ id: participants.id });

    const p2 = await db
      .insert(participants)
      .values({
        externalParticipantId: 'P-DEV-002',
        name: 'Ravi Teja',
        email: 'ravi.dev@example.com',
        phone: '+91-9876543211',
        college: 'National Institute of Technology',
      })
      .onConflictDoNothing({ target: participants.externalParticipantId })
      .returning({ id: participants.id });

    if (p1[0] && p2[0]) {
      await db
        .insert(teamMembers)
        .values([
          { teamId: teamAlphaId, participantId: p1[0].id },
          { teamId: teamAlphaId, participantId: p2[0].id },
        ])
        .onConflictDoNothing();
    }
  }

  // Team Beta (1 member: Priya)
  const existingBeta = await db
    .select()
    .from(teams)
    .where(eq(teams.teamCode, 'DEV-BETA-002'))
    .limit(1);

  if (existingBeta.length === 0) {
    const insBeta = await db
      .insert(teams)
      .values({
        teamName: 'Development Team Beta',
        teamCode: 'DEV-BETA-002',
        externalTeamId: 'EXT-TEAM-002',
        registeredMemberCount: 1,
        status: 'ACTIVE',
      })
      .returning({ id: teams.id });
    const teamBetaId = insBeta[0].id;

    const p3 = await db
      .insert(participants)
      .values({
        externalParticipantId: 'P-DEV-003',
        name: 'Priya Sharma',
        email: 'priya.dev@example.com',
        phone: '+91-9876543212',
        college: 'Indian Institute of Information Technology',
      })
      .onConflictDoNothing({ target: participants.externalParticipantId })
      .returning({ id: participants.id });

    if (p3[0]) {
      await db
        .insert(teamMembers)
        .values([{ teamId: teamBetaId, participantId: p3[0].id }])
        .onConflictDoNothing();
    }
  }

  // Team Gamma (DISABLED for testing)
  const existingGamma = await db
    .select()
    .from(teams)
    .where(eq(teams.teamCode, 'DEV-GAMMA-003'))
    .limit(1);

  if (existingGamma.length === 0) {
    await db
      .insert(teams)
      .values({
        teamName: 'Development Team Gamma',
        teamCode: 'DEV-GAMMA-003',
        externalTeamId: 'EXT-TEAM-003',
        registeredMemberCount: 2,
        status: 'DISABLED',
      })
      .onConflictDoNothing();
  }

  // Team Delta (DISQUALIFIED for testing)
  const existingDelta = await db
    .select()
    .from(teams)
    .where(eq(teams.teamCode, 'DEV-DELTA-004'))
    .limit(1);

  if (existingDelta.length === 0) {
    await db
      .insert(teams)
      .values({
        teamName: 'Development Team Delta',
        teamCode: 'DEV-DELTA-004',
        externalTeamId: 'EXT-TEAM-004',
        registeredMemberCount: 2,
        status: 'DISQUALIFIED',
      })
      .onConflictDoNothing();
  }
}

export async function clearAllTeamsAndParticipants(): Promise<void> {
  await db.delete(teamUnlockedRounds);
  await db.delete(progressionOverrides);
  await db.delete(teamChallenges);
  await db.delete(sessions);
  await db.delete(teamMembers);
  await db.delete(participants);
  await db.delete(teams);
}

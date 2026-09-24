import { describe, it } from 'node:test';
import assert from 'node:assert';
import { db } from '../src/db/index.ts';
import { participants, sessions, antiCheatEvents } from '../src/db/schema.ts';
import { antiCheatRepository } from '../backend/repositories/antiCheatRepository.ts';
import { antiCheatService } from '../backend/services/antiCheatService.ts';
import { runMigrations } from '../database/migrator.ts';

describe('Anti-Cheat Solo Participant Persistence', () => {
  it('safely records anti-cheat events for solo participants without team_id foreign key error', async () => {
    // 1. Ensure migrations are applied
    await runMigrations();

    // 2. Create a solo participant
    const [part] = await db
      .insert(participants)
      .values({
        name: 'Test Solo Competitor',
        participantCode: 'SOLO-TEST-1',
        status: 'ACTIVE',
      })
      .returning();

    assert(part?.id, 'Participant created');

    // 3. Create a session for this solo participant with null teamId
    const [sess] = await db
      .insert(sessions)
      .values({
        participantId: part.id,
        teamId: null,
        sessionTokenHash: 'dummy-token-hash-solo-anticheat',
        status: 'ACTIVE',
      })
      .returning();

    assert(sess?.id, 'Session created');

    // 4. Test recording an event with only participantId and null teamId
    const recorded1 = await antiCheatRepository.recordEvent({
      participantId: part.id,
      teamId: null,
      participantSessionId: sess.id,
      eventType: 'FULLSCREEN_EXIT',
      metadata: { reason: 'Esc key' },
    });

    assert.strictEqual(recorded1.participantId, part.id, 'participantId preserved');
    assert.strictEqual(recorded1.teamId, null, 'teamId is null');
    assert.strictEqual(recorded1.eventType, 'FULLSCREEN_EXIT');

    // 5. Test recording an event where teamId was set to participantId (the exact bug scenario)
    const recorded2 = await antiCheatRepository.recordEvent({
      teamId: part.id, // participant id passed as teamId
      participantSessionId: sess.id,
      eventType: 'TAB_HIDDEN',
      metadata: { visibilityState: 'hidden' },
    });

    assert.strictEqual(recorded2.participantId, part.id, 'participantId resolved from teamId parameter');
    assert.strictEqual(recorded2.teamId, null, 'invalid teamId neutralized to null');
    assert.strictEqual(recorded2.eventType, 'TAB_HIDDEN');

    // 6. Test recording via antiCheatService.recordClientEvent
    const clientResult = await antiCheatService.recordClientEvent({
      participantId: part.id,
      teamId: null,
      sessionId: sess.id,
      eventType: 'WINDOW_BLUR',
      metadata: { hasFocus: false },
    });

    assert.strictEqual(clientResult.recorded, true, 'Event recorded through service');
    assert.strictEqual(clientResult.event?.participantId, part.id);

    // 7. Verify events retrieval joins participant name
    const events = await antiCheatRepository.getEvents({ participantId: part.id });
    assert(events.length >= 3, 'All events fetched');
    assert.strictEqual(events[0].teamName, 'Test Solo Competitor', 'Participant name mapped to competitor display name');
    assert.strictEqual(events[0].teamCode, 'SOLO-TEST-1', 'Participant code mapped to competitor code');

    // 8. Verify getTeamsByViolations includes this competitor
    const violations = await antiCheatRepository.getTeamsByViolations();
    const competitorEntry = violations.find((v) => v.teamId === part.id);
    assert(competitorEntry, 'Solo competitor included in violations ranking');
    assert.strictEqual(competitorEntry?.teamName, 'Test Solo Competitor');
  });
});

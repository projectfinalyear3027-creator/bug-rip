/**
 * BUG RIP - PostgreSQL Database Schema Definition (Drizzle ORM)
 * Canonical relational schema enforcing all immutable BUG RIP competition invariants.
 */

import {
  pgTable,
  text,
  integer,
  smallint,
  boolean,
  timestamp,
  uuid,
  varchar,
  jsonb,
  uniqueIndex,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// -----------------------------------------------------------------------------
// Enums
// -----------------------------------------------------------------------------
export const adminRoleEnum = pgEnum('admin_role', ['ADMIN', 'SUPER_ADMIN']);

export const teamStatusEnum = pgEnum('team_status', ['ACTIVE', 'DISABLED', 'DISQUALIFIED']);

export const challengeValidationTypeEnum = pgEnum('challenge_validation_type', [
  'EXACT_OUTPUT',
  'NORMALIZED_OUTPUT',
  'MULTI_LINE_OUTPUT',
  'TEST_CASE_VALIDATION',
  'CUSTOM_VALIDATOR',
]);

export const teamChallengeStatusEnum = pgEnum('team_challenge_status', [
  'LOCKED',
  'AVAILABLE',
  'IN_PROGRESS',
  'COMPLETED',
]);

export const submissionExecutionStatusEnum = pgEnum('submission_execution_status', [
  'QUEUED',
  'RUNNING',
  'SUCCESS',
  'COMPILE_ERROR',
  'RUNTIME_ERROR',
  'TIMEOUT',
  'MEMORY_LIMIT',
  'OUTPUT_LIMIT',
  'SANDBOX_ERROR',
  'QUEUE_ERROR',
]);

export const sessionStatusEnum = pgEnum('session_status', [
  'ACTIVE',
  'DISCONNECTED',
  'EXPIRED',
  'TERMINATED',
]);

export const antiCheatEventTypeEnum = pgEnum('anti_cheat_event_type', [
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
]);

export const antiCheatActionEnum = pgEnum('anti_cheat_action', [
  'WARNING',
  'RECORDED_VIOLATION',
  'TEMPORARY_LOCK',
  'ADMIN_REVIEW',
  'DISQUALIFICATION',
  'LOGGED',
  'VERIFIED_CLEAR',
  'FLAGGED_VIOLATION',
]);

export const eventStatusEnum = pgEnum('event_status', [
  'NOT_STARTED',
  'RUNNING',
  'PAUSED',
  'ENDED',
]);

export const progressionModeEnum = pgEnum('progression_mode', [
  'SEQUENTIAL',
  'UNLOCK_ALL',
  'CUSTOM',
]);

// -----------------------------------------------------------------------------
// 1. Admin Users Table
// -----------------------------------------------------------------------------
export const adminUsers = pgTable(
  'admin_users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    username: varchar('username', { length: 64 }).notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    displayName: varchar('display_name', { length: 120 }).notNull(),
    role: adminRoleEnum('role').default('ADMIN').notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_admin_users_username').on(table.username),
  ]
);

// -----------------------------------------------------------------------------
// 1b. Admin Sessions Table (Organizer Control Center Sessions)
// -----------------------------------------------------------------------------
export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    adminUserId: uuid('admin_user_id')
      .references(() => adminUsers.id, { onDelete: 'cascade' })
      .notNull(),
    sessionTokenHash: varchar('session_token_hash', { length: 128 }).notNull().unique(),
    status: varchar('status', { length: 32 }).default('ACTIVE').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    userAgent: text('user_agent'),
    ipAddress: varchar('ip_address', { length: 45 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_admin_sessions_token').on(table.sessionTokenHash),
    index('idx_admin_sessions_user').on(table.adminUserId),
    index('idx_admin_sessions_status').on(table.status),
  ]
);

// -----------------------------------------------------------------------------
// 2. Teams Table (The Competition Unit)
// -----------------------------------------------------------------------------
export const teams = pgTable(
  'teams',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    externalTeamId: varchar('external_team_id', { length: 64 }),
    teamName: varchar('team_name', { length: 120 }).notNull(),
    teamCode: varchar('team_code', { length: 64 }).notNull().unique(), // Sourced strictly from CSV
    registeredMemberCount: smallint('registered_member_count').notNull().default(1),
    status: teamStatusEnum('status').default('ACTIVE').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_teams_code').on(table.teamCode),
    index('idx_teams_status').on(table.status),
  ]
);

// -----------------------------------------------------------------------------
// 3. Participants Table (From Symposium CSV - The Canonical Competition Unit)
// -----------------------------------------------------------------------------
export const participants = pgTable(
  'participants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    externalParticipantId: varchar('external_participant_id', { length: 64 }).unique(),
    participantCode: varchar('participant_code', { length: 64 }).unique(), // Unique solo participant credential/code
    name: varchar('name', { length: 120 }).notNull(),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 32 }),
    college: varchar('college', { length: 255 }),
    status: varchar('status', { length: 32 }).default('ACTIVE').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_participants_external_id').on(table.externalParticipantId),
    index('idx_participants_code').on(table.participantCode),
    index('idx_participants_status').on(table.status),
  ]
);

// -----------------------------------------------------------------------------
// 4. Team Members (Linking Participants to Teams; 1, 2, or 3 members max)
// -----------------------------------------------------------------------------
export const teamMembers = pgTable(
  'team_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .references(() => teams.id, { onDelete: 'cascade' })
      .notNull(),
    participantId: uuid('participant_id')
      .references(() => participants.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_team_participant').on(table.teamId, table.participantId),
    index('idx_team_members_team_id').on(table.teamId),
    index('idx_team_members_participant_id').on(table.participantId),
  ]
);

// -----------------------------------------------------------------------------
// 5. Rounds / Difficulties Table (Easy, Medium, Hard, Extreme)
// -----------------------------------------------------------------------------
export const rounds = pgTable(
  'rounds',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 64 }).notNull(),
    slug: varchar('slug', { length: 32 }).notNull().unique(), // 'easy', 'medium', 'hard', 'extreme'
    displayOrder: integer('display_order').notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    unlockRequiredSolves: integer('unlock_required_solves').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_rounds_order').on(table.displayOrder),
    index('idx_rounds_slug').on(table.slug),
  ]
);

// -----------------------------------------------------------------------------
// 6. Challenges Table
// -----------------------------------------------------------------------------
export const challenges = pgTable(
  'challenges',
  {
    id: varchar('id', { length: 64 }).primaryKey(), // e.g. 'EASY-01-FACTORIAL'
    roundId: uuid('round_id')
      .references(() => rounds.id, { onDelete: 'restrict' })
      .notNull(),
    title: varchar('title', { length: 150 }).notNull(),
    slug: varchar('slug', { length: 80 }).notNull().unique(),
    description: text('description').notNull(),
    starterCode: text('starter_code').notNull(),
    solutionCode: text('solution_code'), // Reference solution Java code (ADMIN & VERIFICATION ONLY - NEVER sent to participants)
    adminNotes: text('admin_notes'), // Private internal organizer notes (ADMIN ONLY - NEVER sent to participants)
    score: integer('score').notNull().default(10),
    displayOrder: integer('display_order').notNull().default(0),
    validationType: challengeValidationTypeEnum('validation_type')
      .default('EXACT_OUTPUT')
      .notNull(),
    timeLimitMs: integer('time_limit_ms').notNull().default(3000),
    memoryLimitMb: integer('memory_limit_mb').notNull().default(256),
    maxOutputBytes: integer('max_output_bytes').notNull().default(65536),
    maxSourceBytes: integer('max_source_bytes').notNull().default(32768),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_challenges_round_id').on(table.roundId),
    index('idx_challenges_active').on(table.isActive),
    index('idx_challenges_slug').on(table.slug),
  ]
);

// -----------------------------------------------------------------------------
// 7. Challenge Test Cases Table (Public and Hidden)
// -----------------------------------------------------------------------------
export const challengeTestCases = pgTable(
  'challenge_test_cases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    challengeId: varchar('challenge_id', { length: 64 })
      .references(() => challenges.id, { onDelete: 'cascade' })
      .notNull(),
    testType: varchar('test_type', { length: 32 }).default('STANDARD').notNull(),
    inputData: text('input_data').notNull(),
    expectedOutput: text('expected_output').notNull(),
    explanation: text('explanation'),
    isHidden: boolean('is_hidden').default(false).notNull(),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_test_cases_challenge_id').on(table.challengeId),
    uniqueIndex('idx_test_cases_order_uq').on(table.challengeId, table.isHidden, table.displayOrder),
  ]
);

// -----------------------------------------------------------------------------
// 8. Challenge Flags (Secure Server-Side Flag Storage)
// -----------------------------------------------------------------------------
export const challengeFlags = pgTable(
  'challenge_flags',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    challengeId: varchar('challenge_id', { length: 64 })
      .references(() => challenges.id, { onDelete: 'cascade' })
      .notNull()
      .unique(),
    flagVerifier: varchar('flag_verifier', { length: 256 }).notNull(), // Hash / secret verifier
    flagMetadata: jsonb('flag_metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_challenge_flags_challenge_id').on(table.challengeId),
  ]
);

// -----------------------------------------------------------------------------
// 9. Team Challenge Progress (Legacy Support & Group Compatibility)
// Mandatory UNIQUE constraint: (team_id, challenge_id)
// -----------------------------------------------------------------------------
export const teamChallenges = pgTable(
  'team_challenges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .references(() => teams.id, { onDelete: 'cascade' })
      .notNull(),
    challengeId: varchar('challenge_id', { length: 64 })
      .references(() => challenges.id, { onDelete: 'restrict' })
      .notNull(),
    status: teamChallengeStatusEnum('status').default('AVAILABLE').notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(), // Informational only; unlimited attempts permitted
    unlockedAt: timestamp('unlocked_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completionTimestamp: timestamp('completion_timestamp', { withTimezone: true }), // Authoritative server timestamp
    completedBySessionId: uuid('completed_by_session_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_team_challenge').on(table.teamId, table.challengeId),
    index('idx_team_challenges_team').on(table.teamId),
    index('idx_team_challenges_challenge').on(table.challengeId),
    index('idx_team_challenges_status').on(table.status),
  ]
);

// -----------------------------------------------------------------------------
// 9b. Participant Challenge Progress (The Authoritative Solo Competition Model)
// Mandatory UNIQUE constraint: (participant_id, challenge_id)
// -----------------------------------------------------------------------------
export const participantChallenges = pgTable(
  'participant_challenges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    participantId: uuid('participant_id')
      .references(() => participants.id, { onDelete: 'cascade' })
      .notNull(),
    challengeId: varchar('challenge_id', { length: 64 })
      .references(() => challenges.id, { onDelete: 'restrict' })
      .notNull(),
    status: teamChallengeStatusEnum('status').default('AVAILABLE').notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completionTimestamp: timestamp('completion_timestamp', { withTimezone: true }),
    completedBySessionId: uuid('completed_by_session_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_participant_challenge').on(table.participantId, table.challengeId),
    index('idx_participant_challenges_participant').on(table.participantId),
    index('idx_participant_challenges_challenge').on(table.challengeId),
    index('idx_participant_challenges_status').on(table.status),
  ]
);

// -----------------------------------------------------------------------------
// 10. Sessions Table (Active Participant Connections)
// -----------------------------------------------------------------------------
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .references(() => teams.id, { onDelete: 'cascade' }),
    participantId: uuid('participant_id')
      .references(() => participants.id, { onDelete: 'cascade' }),
    sessionTokenHash: varchar('session_token_hash', { length: 128 }).notNull().unique(),
    status: sessionStatusEnum('status').default('ACTIVE').notNull(),
    connectedAt: timestamp('connected_at', { withTimezone: true }).defaultNow().notNull(),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }).defaultNow().notNull(),
    disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
    userAgent: text('user_agent'),
    ipAddress: varchar('ip_address', { length: 45 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_sessions_team_id').on(table.teamId),
    index('idx_sessions_participant_id').on(table.participantId),
    index('idx_sessions_status').on(table.status),
    index('idx_sessions_last_heartbeat').on(table.lastHeartbeatAt),
  ]
);

// -----------------------------------------------------------------------------
// 11. Submissions Table (Execution Attempts - Unlimited)
// -----------------------------------------------------------------------------
export const submissions = pgTable(
  'submissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .references(() => teams.id, { onDelete: 'cascade' }),
    participantId: uuid('participant_id')
      .references(() => participants.id, { onDelete: 'cascade' }),
    challengeId: varchar('challenge_id', { length: 64 })
      .references(() => challenges.id, { onDelete: 'restrict' })
      .notNull(),
    sessionId: uuid('session_id')
      .references(() => sessions.id, { onDelete: 'set null' }),
    sourceCode: text('source_code').notNull(),
    executionStatus: submissionExecutionStatusEnum('execution_status')
      .default('QUEUED')
      .notNull(),
    stdout: text('stdout'),
    stderr: text('stderr'),
    executionTimeMs: integer('execution_time_ms'),
    memoryUsedBytes: integer('memory_used_bytes'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    workerId: varchar('worker_id', { length: 64 }),
    behaviorStatus: varchar('behavior_status', { length: 32 }).default('PENDING'),
    behaviorDiagnostics: jsonb('behavior_diagnostics'),
    revealedFlag: varchar('revealed_flag', { length: 256 }),
    matchNumber: integer('match_number').notNull().default(1),
    matchId: uuid('match_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_submissions_team_id').on(table.teamId),
    index('idx_submissions_participant_id').on(table.participantId),
    index('idx_submissions_challenge_id').on(table.challengeId),
    index('idx_submissions_match_number').on(table.matchNumber),
    index('idx_submissions_created_at').on(table.createdAt),
  ]
);

// -----------------------------------------------------------------------------
// 12. Flag Submissions Table
// -----------------------------------------------------------------------------
export const flagSubmissions = pgTable(
  'flag_submissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .references(() => teams.id, { onDelete: 'cascade' }),
    participantId: uuid('participant_id')
      .references(() => participants.id, { onDelete: 'cascade' }),
    challengeId: varchar('challenge_id', { length: 64 })
      .references(() => challenges.id, { onDelete: 'restrict' })
      .notNull(),
    sessionId: uuid('session_id')
      .references(() => sessions.id, { onDelete: 'set null' }),
    submissionId: uuid('submission_id')
      .references(() => submissions.id, { onDelete: 'set null' }),
    submittedFlagHash: varchar('submitted_flag_hash', { length: 128 }).notNull(),
    valid: boolean('valid').notNull(),
    flagRevealedInRun: boolean('flag_revealed_in_run').default(false),
    matchNumber: integer('match_number').notNull().default(1),
    matchId: uuid('match_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_flag_submissions_team_id').on(table.teamId),
    index('idx_flag_submissions_participant_id').on(table.participantId),
    index('idx_flag_submissions_challenge_id').on(table.challengeId),
    index('idx_flag_submissions_submission_id').on(table.submissionId),
    index('idx_flag_submissions_match_number').on(table.matchNumber),
  ]
);

// -----------------------------------------------------------------------------
// 13. Anti-Cheat Events Table
// -----------------------------------------------------------------------------
export const antiCheatEvents = pgTable(
  'anti_cheat_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .references(() => teams.id, { onDelete: 'cascade' }),
    participantId: uuid('participant_id')
      .references(() => participants.id, { onDelete: 'cascade' }),
    participantSessionId: uuid('participant_session_id')
      .references(() => sessions.id, { onDelete: 'set null' }),
    challengeId: varchar('challenge_id', { length: 64 }),
    eventType: antiCheatEventTypeEnum('event_type').notNull(),
    actionTaken: antiCheatActionEnum('action_taken').default('RECORDED_VIOLATION').notNull(),
    metadata: jsonb('metadata'),
    reviewedBy: uuid('reviewed_by')
      .references(() => adminUsers.id, { onDelete: 'set null' }),
    adminNotes: text('admin_notes'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    matchNumber: integer('match_number').notNull().default(1),
    matchId: uuid('match_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_anti_cheat_team_id').on(table.teamId),
    index('idx_anti_cheat_participant_id').on(table.participantId),
    index('idx_anti_cheat_match_number').on(table.matchNumber),
    index('idx_anti_cheat_created_at').on(table.createdAt),
  ]
);

// -----------------------------------------------------------------------------
// 13.1 Competition Matches Table (Multiple Match Runs & History)
// -----------------------------------------------------------------------------
export const competitionMatches = pgTable(
  'competition_matches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    matchNumber: integer('match_number').notNull().unique(),
    name: varchar('name', { length: 120 }).notNull(),
    status: eventStatusEnum('status').notNull().default('NOT_STARTED'),
    durationMinutes: integer('duration_minutes').notNull().default(60),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    totalPausedDurationSeconds: integer('total_paused_duration_seconds').notNull().default(0),
    finalLeaderboard: jsonb('final_leaderboard'),
    summary: jsonb('summary'),
    endedReason: text('ended_reason'),
    createdByAdminId: uuid('created_by_admin_id')
      .references(() => adminUsers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_competition_matches_status').on(table.status),
    index('idx_competition_matches_number').on(table.matchNumber),
  ]
);

// -----------------------------------------------------------------------------
// 13.2 Match Historical Challenges Archive
// -----------------------------------------------------------------------------
export const matchHistoricalChallenges = pgTable(
  'match_historical_challenges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    matchId: uuid('match_id')
      .references(() => competitionMatches.id, { onDelete: 'cascade' }),
    matchNumber: integer('match_number').notNull(),
    teamId: uuid('team_id')
      .references(() => teams.id, { onDelete: 'cascade' })
      .notNull(),
    challengeId: varchar('challenge_id', { length: 64 })
      .references(() => challenges.id, { onDelete: 'restrict' })
      .notNull(),
    status: teamChallengeStatusEnum('status').notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completionTimestamp: timestamp('completion_timestamp', { withTimezone: true }),
    completedBySessionId: uuid('completed_by_session_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_hist_challenges_match').on(table.matchId),
    index('idx_hist_challenges_match_num').on(table.matchNumber),
    index('idx_hist_challenges_team').on(table.teamId),
  ]
);

// -----------------------------------------------------------------------------
// 14. Event Settings Table (Single Authoritative Row)
// -----------------------------------------------------------------------------
export const eventSettings = pgTable(
  'event_settings',
  {
    id: integer('id').primaryKey().default(1),
    eventName: varchar('event_name', { length: 120 }).notNull().default('BUG SNIPER'),
    status: eventStatusEnum('status').notNull().default('NOT_STARTED'),
    durationMinutes: integer('duration_minutes').notNull().default(60),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    totalPausedDurationSeconds: integer('total_paused_duration_seconds').notNull().default(0),
    progressionMode: progressionModeEnum('progression_mode').notNull().default('SEQUENTIAL'),
    minTeamMembers: smallint('min_team_members').notNull().default(1),
    maxTeamMembers: smallint('max_team_members').notNull().default(3),
    fullscreenRequired: boolean('fullscreen_required').notNull().default(false),
    liveScoreboardEnabled: boolean('live_scoreboard_enabled').notNull().default(true),
    showTeamMembersOnLive: boolean('show_team_members_on_live').notNull().default(true),
    showCurrentRoundOnLive: boolean('show_current_round_on_live').notNull().default(true),
    showTimerOnLive: boolean('show_timer_on_live').notNull().default(true),
    currentMatchNumber: integer('current_match_number').notNull().default(1),
    currentMatchId: uuid('current_match_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  }
);

// -----------------------------------------------------------------------------
// 15. Audit Logs Table (Admin & System Actions)
// -----------------------------------------------------------------------------
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    adminUserId: uuid('admin_user_id')
      .references(() => adminUsers.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 64 }).notNull(),
    targetType: varchar('target_type', { length: 64 }),
    targetId: varchar('target_id', { length: 128 }),
    reason: text('reason'),
    metadata: jsonb('metadata'),
    matchNumber: integer('match_number').notNull().default(1),
    matchId: uuid('match_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_audit_logs_admin_user_id').on(table.adminUserId),
    index('idx_audit_logs_created_at').on(table.createdAt),
  ]
);

// -----------------------------------------------------------------------------
// 16. Team Unlocked Rounds (Legacy Support & Group Compatibility)
// -----------------------------------------------------------------------------
export const teamUnlockedRounds = pgTable(
  'team_unlocked_rounds',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .references(() => teams.id, { onDelete: 'cascade' })
      .notNull(),
    roundId: uuid('round_id')
      .references(() => rounds.id, { onDelete: 'cascade' })
      .notNull(),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true }).defaultNow().notNull(),
    unlockedReason: varchar('unlocked_reason', { length: 32 }).default('THRESHOLD_REACHED').notNull(),
  },
  (table) => [
    uniqueIndex('uq_team_unlocked_round').on(table.teamId, table.roundId),
    index('idx_team_unlocked_rounds_team').on(table.teamId),
    index('idx_team_unlocked_rounds_round').on(table.roundId),
  ]
);

// -----------------------------------------------------------------------------
// 16b. Participant Unlocked Rounds (Monotonic Difficulty Unlock Retention per Solo Competitor)
// -----------------------------------------------------------------------------
export const participantUnlockedRounds = pgTable(
  'participant_unlocked_rounds',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    participantId: uuid('participant_id')
      .references(() => participants.id, { onDelete: 'cascade' })
      .notNull(),
    roundId: uuid('round_id')
      .references(() => rounds.id, { onDelete: 'cascade' })
      .notNull(),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true }).defaultNow().notNull(),
    unlockedReason: varchar('unlocked_reason', { length: 32 }).default('THRESHOLD_REACHED').notNull(),
  },
  (table) => [
    uniqueIndex('uq_participant_unlocked_round').on(table.participantId, table.roundId),
    index('idx_participant_unlocked_rounds_participant').on(table.participantId),
    index('idx_participant_unlocked_rounds_round').on(table.roundId),
  ]
);

// -----------------------------------------------------------------------------
// 17. Progression Overrides Table (Administrative Progression Control)
// -----------------------------------------------------------------------------
export const progressionOverrides = pgTable(
  'progression_overrides',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    targetType: varchar('target_type', { length: 32 }).notNull(), // 'ALL_DIFFICULTIES', 'ROUND', 'CHALLENGE'
    targetId: varchar('target_id', { length: 64 }),
    teamId: uuid('team_id')
      .references(() => teams.id, { onDelete: 'cascade' }),
    participantId: uuid('participant_id')
      .references(() => participants.id, { onDelete: 'cascade' }),
    adminUserId: uuid('admin_user_id')
      .references(() => adminUsers.id, { onDelete: 'set null' }),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_progression_overrides_target').on(table.targetType, table.targetId),
    index('idx_progression_overrides_team').on(table.teamId),
    index('idx_progression_overrides_participant').on(table.participantId),
  ]
);

// -----------------------------------------------------------------------------
// Relations
// -----------------------------------------------------------------------------
export const teamsRelations = relations(teams, ({ many }) => ({
  members: many(teamMembers),
  sessions: many(sessions),
  challenges: many(teamChallenges),
  submissions: many(submissions),
  antiCheatEvents: many(antiCheatEvents),
}));

export const participantsRelations = relations(participants, ({ many }) => ({
  teamMembers: many(teamMembers),
  sessions: many(sessions),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, {
    fields: [teamMembers.teamId],
    references: [teams.id],
  }),
  participant: one(participants, {
    fields: [teamMembers.participantId],
    references: [participants.id],
  }),
}));

export const roundsRelations = relations(rounds, ({ many }) => ({
  challenges: many(challenges),
}));

export const challengesRelations = relations(challenges, ({ one, many }) => ({
  round: one(rounds, {
    fields: [challenges.roundId],
    references: [rounds.id],
  }),
  testCases: many(challengeTestCases),
  flag: one(challengeFlags, {
    fields: [challenges.id],
    references: [challengeFlags.challengeId],
  }),
  teamChallenges: many(teamChallenges),
  submissions: many(submissions),
}));

export const teamChallengesRelations = relations(teamChallenges, ({ one }) => ({
  team: one(teams, {
    fields: [teamChallenges.teamId],
    references: [teams.id],
  }),
  challenge: one(challenges, {
    fields: [teamChallenges.challengeId],
    references: [challenges.id],
  }),
}));

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  team: one(teams, {
    fields: [sessions.teamId],
    references: [teams.id],
  }),
  participant: one(participants, {
    fields: [sessions.participantId],
    references: [participants.id],
  }),
  submissions: many(submissions),
}));

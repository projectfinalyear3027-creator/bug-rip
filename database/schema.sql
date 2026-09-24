-- ============================================================================
-- BUG RIP: PostgreSQL Database Schema
-- Canonical database foundation for Java Debugging CTF Competition
-- Enforces:
-- 1. Immutable 1-3 member team constraint
-- 2. Secret team credentials imported strictly from CSV (never auto-generated)
-- 3. Atomic race condition protection: only first solve counts
-- 4. Authoritative leaderboard ranking: Solved Count -> Score -> Earliest Time
-- ============================================================================

-- Create Enums
DO $$ BEGIN
  CREATE TYPE competition_event_state AS ENUM ('NOT_STARTED', 'RUNNING', 'PAUSED', 'ENDED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE challenge_difficulty_level AS ENUM ('EASY', 'MEDIUM', 'HARD', 'EXTREME');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 1. Teams Table
-- Team credentials come directly from the imported CSV.
-- BUG RIP NEVER generates team codes; team_code is unique and imported.
CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_name VARCHAR(120) NOT NULL,
  team_code VARCHAR(64) NOT NULL UNIQUE,
  registered_member_count SMALLINT NOT NULL CHECK (registered_member_count BETWEEN 1 AND 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teams_name_code ON teams(LOWER(TRIM(team_name)), team_code);

-- 2. Participants Table
-- Stores individual registered members for each team imported from CSV.
CREATE TABLE IF NOT EXISTS participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id VARCHAR(64) NOT NULL UNIQUE, -- Sourced from CSV e.g., P001
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(255) NOT NULL,
  college VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_participants_team_id ON participants(team_id);

-- 3. Active Sessions Table
-- Enforces max 1 concurrent session for 1-member teams, max 2 for 2-member teams.
CREATE TABLE IF NOT EXISTS team_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  participant_id VARCHAR(64),
  session_token_hash VARCHAR(128) NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_sessions_active ON team_sessions(team_id) WHERE is_active = true;

-- 4. Challenges Table
-- Flag hash is stored for server-side verification; raw flag is NEVER exposed via APIs.
CREATE TABLE IF NOT EXISTS challenges (
  id VARCHAR(64) PRIMARY KEY, -- e.g., 'EASY-01-FACTORIAL'
  title VARCHAR(150) NOT NULL,
  difficulty challenge_difficulty_level NOT NULL,
  points INTEGER NOT NULL DEFAULT 10,
  order_index INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  starter_code TEXT NOT NULL,
  flag_hash VARCHAR(128) NOT NULL, -- SHA-256 or bcrypt hash
  verification_class VARCHAR(120) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_challenges_diff ON challenges(difficulty, order_index);

-- 5. Difficulty Progression / Unlocks
CREATE TABLE IF NOT EXISTS team_difficulty_unlocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  difficulty challenge_difficulty_level NOT NULL,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_admin_override BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT uq_team_difficulty UNIQUE (team_id, difficulty)
);

-- 6. Team Submissions & Atomic Solve Protection
-- Race-condition protection: UNIQUE partial index guarantees only 1 valid first-solve per team per challenge.
CREATE TABLE IF NOT EXISTS team_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  challenge_id VARCHAR(64) NOT NULL REFERENCES challenges(id) ON DELETE RESTRICT,
  session_id UUID REFERENCES team_sessions(id) ON DELETE SET NULL,
  participant_id VARCHAR(64),
  submitted_flag VARCHAR(120) NOT NULL,
  is_valid BOOLEAN NOT NULL,
  is_first_solve BOOLEAN NOT NULL DEFAULT false,
  awarded_points INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensures that only ONE record per (team_id, challenge_id) can ever have is_first_solve = true
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_challenge_first_solve
ON team_submissions(team_id, challenge_id)
WHERE is_first_solve = true;

CREATE INDEX IF NOT EXISTS idx_submissions_team ON team_submissions(team_id, created_at);

-- 7. Competition Event State (Single-row server authoritative state)
CREATE TABLE IF NOT EXISTS event_state (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  state competition_event_state NOT NULL DEFAULT 'NOT_STARTED',
  started_at TIMESTAMPTZ,
  total_duration_seconds INTEGER NOT NULL DEFAULT 3600, -- 60 minutes
  paused_elapsed_seconds INTEGER NOT NULL DEFAULT 0,
  ended_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Initialize default single event state row
INSERT INTO event_state (id, state, total_duration_seconds)
VALUES (1, 'NOT_STARTED', 3600)
ON CONFLICT (id) DO NOTHING;

-- 8. Audit Logs Table (Admin actions, timer changes, anti-cheat flags)
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type VARCHAR(32) NOT NULL, -- 'ADMIN', 'SYSTEM', 'TEAM'
  actor_id VARCHAR(120),
  action VARCHAR(64) NOT NULL,     -- 'EVENT_START', 'DIFFICULTY_OVERRIDE', 'CSV_IMPORT'
  details JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 9. AUTHORITATIVE LEADERBOARD VIEW
-- 
-- WINNER RULE GUARANTEE:
-- PRIMARY:          problems_solved DESC
-- SECONDARY:        total_score DESC
-- FINAL TIEBREAKER: last_solve_timestamp ASC (earliest timestamp wins)
-- ============================================================================
CREATE OR REPLACE VIEW leaderboard_view AS
SELECT 
  t.id AS team_id,
  t.team_name,
  t.registered_member_count,
  COUNT(DISTINCT ts.challenge_id) AS problems_solved,
  COALESCE(SUM(ts.awarded_points), 0)::INTEGER AS total_score,
  COALESCE(MAX(ts.created_at), t.created_at) AS last_solve_timestamp
FROM teams t
LEFT JOIN team_submissions ts ON t.id = ts.team_id AND ts.is_first_solve = true
GROUP BY t.id, t.team_name, t.registered_member_count
ORDER BY 
  problems_solved DESC,
  total_score DESC,
  last_solve_timestamp ASC;

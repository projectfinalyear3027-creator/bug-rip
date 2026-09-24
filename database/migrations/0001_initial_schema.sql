-- ============================================================================
-- BUG RIP - Migration 0001: Initial Relational Database Schema
-- Canonical PostgreSQL Schema for 60-Minute Java Debugging CTF Competition
-- Enforces:
-- 1. 1-3 Member Team Unit Constraint
-- 2. Secret Team Codes imported strictly from CSV (No generation / replacement)
-- 3. Atomic Same-Challenge solve protection: UNIQUE (team_id, challenge_id)
-- 4. Shared team progression & session concurrency limits
-- 5. Canonical Ranking: Solved Count -> Score -> Earliest Timestamp
-- ============================================================================

-- 1. Create Enums
DO $$ BEGIN
  CREATE TYPE admin_role AS ENUM ('ADMIN', 'SUPER_ADMIN');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE team_status AS ENUM ('ACTIVE', 'DISABLED', 'DISQUALIFIED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE challenge_validation_type AS ENUM (
    'EXACT_OUTPUT',
    'NORMALIZED_OUTPUT',
    'MULTI_LINE_OUTPUT',
    'TEST_CASE_VALIDATION',
    'CUSTOM_VALIDATOR'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE team_challenge_status AS ENUM (
    'LOCKED',
    'AVAILABLE',
    'IN_PROGRESS',
    'COMPLETED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE submission_execution_status AS ENUM (
    'QUEUED',
    'RUNNING',
    'SUCCESS',
    'COMPILE_ERROR',
    'RUNTIME_ERROR',
    'TIMEOUT',
    'MEMORY_LIMIT',
    'OUTPUT_LIMIT',
    'SANDBOX_ERROR',
    'QUEUE_ERROR'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE session_status AS ENUM (
    'ACTIVE',
    'DISCONNECTED',
    'EXPIRED',
    'TERMINATED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE anti_cheat_event_type AS ENUM (
    'TAB_HIDDEN',
    'WINDOW_BLUR',
    'FULLSCREEN_EXIT',
    'BROWSER_UNSUPPORTED',
    'PAGE_RELOAD',
    'MULTIPLE_SESSION'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE anti_cheat_action AS ENUM (
    'WARNING',
    'RECORDED_VIOLATION',
    'TEMPORARY_LOCK',
    'ADMIN_REVIEW',
    'DISQUALIFICATION'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE event_status AS ENUM (
    'NOT_STARTED',
    'RUNNING',
    'PAUSED',
    'ENDED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE progression_mode AS ENUM (
    'SEQUENTIAL',
    'UNLOCK_ALL',
    'CUSTOM'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Admin Users Table
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  role admin_role NOT NULL DEFAULT 'ADMIN',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users(username);

-- 3. Teams Table (The Competition Unit)
-- Team code comes from CSV; no generation / replacement allowed.
CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_team_id VARCHAR(64),
  team_name VARCHAR(120) NOT NULL,
  team_code VARCHAR(64) NOT NULL UNIQUE,
  registered_member_count SMALLINT NOT NULL DEFAULT 1 CHECK (registered_member_count BETWEEN 1 AND 3),
  status team_status NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teams_code ON teams(team_code);
CREATE INDEX IF NOT EXISTS idx_teams_status ON teams(status);
CREATE INDEX IF NOT EXISTS idx_teams_lookup ON teams(LOWER(TRIM(team_name)), team_code);

-- 4. Participants Table (From Symposium CSV)
CREATE TABLE IF NOT EXISTS participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_participant_id VARCHAR(64) UNIQUE,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(32),
  college VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_participants_external_id ON participants(external_participant_id);

-- 5. Team Members (Strict 1-3 Members Limit Per Team)
CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_team_participant UNIQUE (team_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_participant_id ON team_members(participant_id);

-- 6. Rounds / Difficulties (Easy, Medium, Hard, Extreme)
CREATE TABLE IF NOT EXISTS rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(64) NOT NULL,
  slug VARCHAR(32) NOT NULL UNIQUE,
  display_order INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  unlock_required_solves INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rounds_order ON rounds(display_order);
CREATE INDEX IF NOT EXISTS idx_rounds_slug ON rounds(slug);

-- 7. Challenges Table
CREATE TABLE IF NOT EXISTS challenges (
  id VARCHAR(64) PRIMARY KEY,
  round_id UUID NOT NULL REFERENCES rounds(id) ON DELETE RESTRICT,
  title VARCHAR(150) NOT NULL,
  slug VARCHAR(80) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  starter_code TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 10,
  display_order INTEGER NOT NULL DEFAULT 0,
  validation_type challenge_validation_type NOT NULL DEFAULT 'EXACT_OUTPUT',
  time_limit_ms INTEGER NOT NULL DEFAULT 3000,
  memory_limit_mb INTEGER NOT NULL DEFAULT 256,
  max_output_bytes INTEGER NOT NULL DEFAULT 65536,
  max_source_bytes INTEGER NOT NULL DEFAULT 32768,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_challenges_round_id ON challenges(round_id);
CREATE INDEX IF NOT EXISTS idx_challenges_active ON challenges(is_active);
CREATE INDEX IF NOT EXISTS idx_challenges_slug ON challenges(slug);

-- 8. Challenge Test Cases (Public & Hidden)
CREATE TABLE IF NOT EXISTS challenge_test_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id VARCHAR(64) NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  test_type VARCHAR(32) NOT NULL DEFAULT 'STANDARD',
  input_data TEXT NOT NULL,
  expected_output TEXT NOT NULL,
  is_hidden BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_test_cases_challenge_id ON challenge_test_cases(challenge_id);

-- 9. Challenge Flags (Secure Server-Side Flag Storage)
CREATE TABLE IF NOT EXISTS challenge_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id VARCHAR(64) NOT NULL REFERENCES challenges(id) ON DELETE CASCADE UNIQUE,
  flag_verifier VARCHAR(256) NOT NULL,
  flag_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_challenge_flags_challenge_id ON challenge_flags(challenge_id);

-- 10. Team Challenge Progress (Shared Team Unit Progress & Completion)
-- Atomic same-challenge solve race protection: UNIQUE (team_id, challenge_id)
CREATE TABLE IF NOT EXISTS team_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  challenge_id VARCHAR(64) NOT NULL REFERENCES challenges(id) ON DELETE RESTRICT,
  status team_challenge_status NOT NULL DEFAULT 'AVAILABLE',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  completion_timestamp TIMESTAMPTZ,
  completed_by_session_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_team_challenge UNIQUE (team_id, challenge_id)
);

CREATE INDEX IF NOT EXISTS idx_team_challenges_team ON team_challenges(team_id);
CREATE INDEX IF NOT EXISTS idx_team_challenges_challenge ON team_challenges(challenge_id);
CREATE INDEX IF NOT EXISTS idx_team_challenges_status ON team_challenges(status);

-- 11. Sessions Table (Active Participant Connections)
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  participant_id UUID REFERENCES participants(id) ON DELETE SET NULL,
  session_token_hash VARCHAR(128) NOT NULL UNIQUE,
  status session_status NOT NULL DEFAULT 'ACTIVE',
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disconnected_at TIMESTAMPTZ,
  user_agent TEXT,
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_team_id ON sessions(team_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_last_heartbeat ON sessions(last_heartbeat_at);

-- 12. Submissions Table (Execution Attempts - Unlimited)
CREATE TABLE IF NOT EXISTS submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  challenge_id VARCHAR(64) NOT NULL REFERENCES challenges(id) ON DELETE RESTRICT,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  source_code TEXT NOT NULL,
  execution_status submission_execution_status NOT NULL DEFAULT 'QUEUED',
  stdout TEXT,
  stderr TEXT,
  execution_time_ms INTEGER,
  memory_used_bytes INTEGER,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  worker_id VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_submissions_team_id ON submissions(team_id);
CREATE INDEX IF NOT EXISTS idx_submissions_challenge_id ON submissions(challenge_id);
CREATE INDEX IF NOT EXISTS idx_submissions_created_at ON submissions(created_at);

-- 13. Flag Submissions Table
CREATE TABLE IF NOT EXISTS flag_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  challenge_id VARCHAR(64) NOT NULL REFERENCES challenges(id) ON DELETE RESTRICT,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  submitted_flag_hash VARCHAR(128) NOT NULL,
  valid BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flag_submissions_team_id ON flag_submissions(team_id);
CREATE INDEX IF NOT EXISTS idx_flag_submissions_challenge_id ON flag_submissions(challenge_id);

-- 14. Anti-Cheat Events Table
CREATE TABLE IF NOT EXISTS anti_cheat_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  participant_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  challenge_id VARCHAR(64),
  event_type anti_cheat_event_type NOT NULL,
  action_taken anti_cheat_action NOT NULL DEFAULT 'RECORDED_VIOLATION',
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anti_cheat_team_id ON anti_cheat_events(team_id);
CREATE INDEX IF NOT EXISTS idx_anti_cheat_created_at ON anti_cheat_events(created_at);

-- 15. Event Settings Table (Single-Row Authoritative Event Configuration)
CREATE TABLE IF NOT EXISTS event_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  event_name VARCHAR(120) NOT NULL DEFAULT 'BUG RIP',
  status event_status NOT NULL DEFAULT 'NOT_STARTED',
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  total_paused_duration_seconds INTEGER NOT NULL DEFAULT 0,
  progression_mode progression_mode NOT NULL DEFAULT 'SEQUENTIAL',
  min_team_members SMALLINT NOT NULL DEFAULT 1,
  max_team_members SMALLINT NOT NULL DEFAULT 3,
  fullscreen_required BOOLEAN NOT NULL DEFAULT false,
  live_scoreboard_enabled BOOLEAN NOT NULL DEFAULT true,
  show_team_members_on_live BOOLEAN NOT NULL DEFAULT true,
  show_current_round_on_live BOOLEAN NOT NULL DEFAULT true,
  show_timer_on_live BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 16. Audit Logs Table (Admin & System Traceability)
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  action VARCHAR(64) NOT NULL,
  target_type VARCHAR(64),
  target_id VARCHAR(128),
  reason TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_user_id ON audit_logs(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- 17. Authoritative Leaderboard View
-- CANONICAL RANKING HIERARCHY:
-- 1. problems_solved DESC (PRIMARY)
-- 2. total_score DESC     (SECONDARY)
-- 3. last_solve_timestamp ASC (EARLIEST TIMESTAMP WINS)
CREATE OR REPLACE VIEW leaderboard_view AS
SELECT 
  t.id AS team_id,
  t.team_name,
  t.registered_member_count,
  COUNT(tc.challenge_id) FILTER (WHERE tc.status = 'COMPLETED') AS problems_solved,
  COALESCE(SUM(c.score) FILTER (WHERE tc.status = 'COMPLETED'), 0)::INTEGER AS total_score,
  COALESCE(MAX(tc.completion_timestamp) FILTER (WHERE tc.status = 'COMPLETED'), t.created_at) AS last_solve_timestamp
FROM teams t
LEFT JOIN team_challenges tc ON t.id = tc.team_id
LEFT JOIN challenges c ON tc.challenge_id = c.id
WHERE t.status = 'ACTIVE'
GROUP BY t.id, t.team_name, t.registered_member_count
ORDER BY 
  problems_solved DESC,
  total_score DESC,
  last_solve_timestamp ASC;

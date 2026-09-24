-- =============================================================================
-- Migration 0011: Transition to Canonical Solo Individual Competition Model
-- 
-- 1. Updates participants table with individual credentials and status
-- 2. Makes team_id nullable across sessions, submissions, flags, anti-cheat
-- 3. Adds participant_id to submissions, flag_submissions, anti_cheat_events, progression_overrides
-- 4. Creates participant_challenges (participant-scoped challenge solves)
-- 5. Creates participant_unlocked_rounds (participant-scoped monotonic unlocks)
-- 6. Backfills existing data safely
-- 7. Updates leaderboard_view to rank individual participants
-- =============================================================================

-- 1. Participant credentials and status
ALTER TABLE participants ADD COLUMN IF NOT EXISTS participant_code VARCHAR(64) UNIQUE;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE';

-- 2. Make team_id nullable to support individual participants without teams
ALTER TABLE sessions ALTER COLUMN team_id DROP NOT NULL;
ALTER TABLE submissions ALTER COLUMN team_id DROP NOT NULL;
ALTER TABLE flag_submissions ALTER COLUMN team_id DROP NOT NULL;
ALTER TABLE anti_cheat_events ALTER COLUMN team_id DROP NOT NULL;

-- 3. Add participant_id foreign keys
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS participant_id UUID REFERENCES participants(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_submissions_participant_id ON submissions(participant_id);

ALTER TABLE flag_submissions ADD COLUMN IF NOT EXISTS participant_id UUID REFERENCES participants(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_flag_submissions_participant_id ON flag_submissions(participant_id);

ALTER TABLE anti_cheat_events ADD COLUMN IF NOT EXISTS participant_id UUID REFERENCES participants(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_anti_cheat_participant_id ON anti_cheat_events(participant_id);

ALTER TABLE progression_overrides ADD COLUMN IF NOT EXISTS participant_id UUID REFERENCES participants(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_progression_overrides_participant_id ON progression_overrides(participant_id);

-- 4. Participant Challenges Table (Authoritative Solo Challenge Completion)
CREATE TABLE IF NOT EXISTS participant_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  challenge_id VARCHAR(64) NOT NULL REFERENCES challenges(id) ON DELETE RESTRICT,
  status team_challenge_status NOT NULL DEFAULT 'AVAILABLE',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  completion_timestamp TIMESTAMPTZ,
  completed_by_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_participant_challenge UNIQUE (participant_id, challenge_id)
);

CREATE INDEX IF NOT EXISTS idx_participant_challenges_participant ON participant_challenges(participant_id);
CREATE INDEX IF NOT EXISTS idx_participant_challenges_challenge ON participant_challenges(challenge_id);
CREATE INDEX IF NOT EXISTS idx_participant_challenges_status ON participant_challenges(status);

-- 5. Participant Unlocked Rounds (Monotonic Difficulty Unlocking per Participant)
CREATE TABLE IF NOT EXISTS participant_unlocked_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  round_id UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unlocked_reason VARCHAR(32) NOT NULL DEFAULT 'THRESHOLD_REACHED',
  CONSTRAINT uq_participant_unlocked_round UNIQUE (participant_id, round_id)
);

CREATE INDEX IF NOT EXISTS idx_participant_unlocked_rounds_participant ON participant_unlocked_rounds(participant_id);
CREATE INDEX IF NOT EXISTS idx_participant_unlocked_rounds_round ON participant_unlocked_rounds(round_id);

-- 6. Safe Data Backfill: Ensure existing participants have a code and preserve progress
UPDATE participants 
SET participant_code = COALESCE(external_participant_id, email, 'P-' || SUBSTRING(id::text, 1, 8))
WHERE participant_code IS NULL;

-- Backfill participant_id on sessions from team_members if present
UPDATE sessions s
SET participant_id = tm.participant_id
FROM team_members tm
WHERE s.team_id = tm.team_id AND s.participant_id IS NULL;

-- Backfill participant_id on submissions
UPDATE submissions sub
SET participant_id = tm.participant_id
FROM team_members tm
WHERE sub.team_id = tm.team_id AND sub.participant_id IS NULL;

-- Backfill participant_id on flag_submissions
UPDATE flag_submissions fs
SET participant_id = tm.participant_id
FROM team_members tm
WHERE fs.team_id = tm.team_id AND fs.participant_id IS NULL;

-- Backfill participant_id on anti_cheat_events
UPDATE anti_cheat_events ace
SET participant_id = tm.participant_id
FROM team_members tm
WHERE ace.team_id = tm.team_id AND ace.participant_id IS NULL;

-- Backfill participant_challenges from existing team_challenges
INSERT INTO participant_challenges (participant_id, challenge_id, status, attempt_count, unlocked_at, started_at, completed_at, completion_timestamp, completed_by_session_id)
SELECT tm.participant_id, tc.challenge_id, tc.status, tc.attempt_count, tc.unlocked_at, tc.started_at, tc.completed_at, tc.completion_timestamp, tc.completed_by_session_id
FROM team_challenges tc
JOIN team_members tm ON tc.team_id = tm.team_id
ON CONFLICT (participant_id, challenge_id) DO NOTHING;

-- Backfill participant_unlocked_rounds
INSERT INTO participant_unlocked_rounds (participant_id, round_id, unlocked_at, unlocked_reason)
SELECT tm.participant_id, tur.round_id, tur.unlocked_at, tur.unlocked_reason
FROM team_unlocked_rounds tur
JOIN team_members tm ON tur.team_id = tm.team_id
ON CONFLICT (participant_id, round_id) DO NOTHING;

-- 7. Create Authoritative Solo Leaderboard View for Individual Participants
-- CANONICAL SOLO RANKING HIERARCHY:
-- 1. problems_solved DESC (PRIMARY)
-- 2. total_score DESC     (SECONDARY)
-- 3. last_solve_timestamp ASC (EARLIEST TIMESTAMP WINS)
-- 4. participant_name ASC (FINAL TIEBREAKER)
CREATE OR REPLACE VIEW participant_leaderboard_view AS
SELECT 
  p.id AS participant_id,
  p.name AS participant_name,
  p.college,
  COUNT(pc.challenge_id) FILTER (WHERE pc.status = 'COMPLETED')::INTEGER AS problems_solved,
  COALESCE(SUM(c.score) FILTER (WHERE pc.status = 'COMPLETED'), 0)::INTEGER AS total_score,
  COALESCE(MAX(pc.completion_timestamp) FILTER (WHERE pc.status = 'COMPLETED'), p.created_at) AS last_solve_timestamp
FROM participants p
LEFT JOIN participant_challenges pc ON p.id = pc.participant_id
LEFT JOIN challenges c ON pc.challenge_id = c.id
WHERE p.status = 'ACTIVE'
GROUP BY p.id, p.name, p.college, p.created_at
ORDER BY 
  problems_solved DESC,
  total_score DESC,
  last_solve_timestamp ASC,
  p.name ASC;

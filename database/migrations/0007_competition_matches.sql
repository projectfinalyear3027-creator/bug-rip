-- Migration 0007: Competition Matches & Historical Run Isolation
-- Adds support for multiple competition runs, match archiving, and fresh resets.

CREATE TABLE IF NOT EXISTS competition_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_number INTEGER NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    status event_status NOT NULL DEFAULT 'NOT_STARTED',
    duration_minutes INTEGER NOT NULL DEFAULT 60,
    started_at TIMESTAMP WITH TIME ZONE,
    ended_at TIMESTAMP WITH TIME ZONE,
    paused_at TIMESTAMP WITH TIME ZONE,
    total_paused_duration_seconds INTEGER NOT NULL DEFAULT 0,
    final_leaderboard JSONB,
    summary JSONB,
    ended_reason TEXT,
    created_by_admin_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_competition_matches_status ON competition_matches(status);
CREATE INDEX IF NOT EXISTS idx_competition_matches_number ON competition_matches(match_number);

-- Event settings current match link
ALTER TABLE event_settings ADD COLUMN IF NOT EXISTS current_match_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE event_settings ADD COLUMN IF NOT EXISTS current_match_id UUID;

-- Historical challenges progress archive for ended matches
CREATE TABLE IF NOT EXISTS match_historical_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID REFERENCES competition_matches(id) ON DELETE CASCADE,
    match_number INTEGER NOT NULL,
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE NOT NULL,
    challenge_id VARCHAR(64) REFERENCES challenges(id) ON DELETE RESTRICT NOT NULL,
    status team_challenge_status NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    unlocked_at TIMESTAMP WITH TIME ZONE,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    completion_timestamp TIMESTAMP WITH TIME ZONE,
    completed_by_session_id UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hist_challenges_match ON match_historical_challenges(match_id);
CREATE INDEX IF NOT EXISTS idx_hist_challenges_match_num ON match_historical_challenges(match_number);
CREATE INDEX IF NOT EXISTS idx_hist_challenges_team ON match_historical_challenges(team_id);

-- Match association on submissions, flags, anti-cheat, and audit
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS match_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS match_id UUID;

ALTER TABLE flag_submissions ADD COLUMN IF NOT EXISTS match_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE flag_submissions ADD COLUMN IF NOT EXISTS match_id UUID;

ALTER TABLE anti_cheat_events ADD COLUMN IF NOT EXISTS match_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE anti_cheat_events ADD COLUMN IF NOT EXISTS match_id UUID;

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS match_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS match_id UUID;

CREATE INDEX IF NOT EXISTS idx_submissions_match_number ON submissions(match_number);
CREATE INDEX IF NOT EXISTS idx_flag_submissions_match_number ON flag_submissions(match_number);
CREATE INDEX IF NOT EXISTS idx_anti_cheat_match_number ON anti_cheat_events(match_number);

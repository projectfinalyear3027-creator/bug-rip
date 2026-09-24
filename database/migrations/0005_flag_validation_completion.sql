-- =============================================================================
-- Migration 0005: Flag Reveal, Behavioral Validation & Completion (Fragment 9)
-- =============================================================================

-- 1. Add behavioral validation columns to submissions table
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS behavior_status VARCHAR(32) DEFAULT 'PENDING';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS behavior_diagnostics JSONB;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS revealed_flag VARCHAR(256);

-- 2. Enhance flag_submissions with execution link and reveal verification
ALTER TABLE flag_submissions ADD COLUMN IF NOT EXISTS submission_id UUID REFERENCES submissions(id) ON DELETE SET NULL;
ALTER TABLE flag_submissions ADD COLUMN IF NOT EXISTS flag_revealed_in_run BOOLEAN DEFAULT false;

-- 3. Create index for fast lookup of successful team executions
CREATE INDEX IF NOT EXISTS idx_submissions_team_challenge_status ON submissions (team_id, challenge_id, execution_status);
CREATE INDEX IF NOT EXISTS idx_flag_submissions_submission_id ON flag_submissions (submission_id);

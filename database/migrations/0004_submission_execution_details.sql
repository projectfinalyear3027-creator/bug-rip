-- =============================================================================
-- Migration 0004: Execution Details for Submissions Table (Fragment 8)
-- =============================================================================

ALTER TABLE submissions ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS worker_id VARCHAR(64);

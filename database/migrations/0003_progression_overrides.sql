-- Migration 0003: Progression Overrides & Monotonic Team Unlocked Rounds
-- Preserves unlocked difficulties permanently and records administrative overrides

CREATE TABLE IF NOT EXISTS team_unlocked_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  round_id UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unlocked_reason VARCHAR(32) NOT NULL DEFAULT 'THRESHOLD_REACHED',
  CONSTRAINT uq_team_unlocked_round UNIQUE (team_id, round_id)
);

CREATE INDEX IF NOT EXISTS idx_team_unlocked_rounds_team ON team_unlocked_rounds(team_id);
CREATE INDEX IF NOT EXISTS idx_team_unlocked_rounds_round ON team_unlocked_rounds(round_id);

CREATE TABLE IF NOT EXISTS progression_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type VARCHAR(32) NOT NULL, -- 'ALL_DIFFICULTIES', 'ROUND', 'CHALLENGE'
  target_id VARCHAR(64),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  admin_user_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_progression_overrides_target ON progression_overrides(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_progression_overrides_team ON progression_overrides(team_id);

-- BUG RIP - Migration 0010: Update Team Size Limit to 1-3 Participants
-- Canonical Rule: 1 to 3 members allowed per team; 4 or more rejected.

DO $$ BEGIN
  ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_registered_member_count_check;
  ALTER TABLE teams ADD CONSTRAINT teams_registered_member_count_check CHECK (registered_member_count BETWEEN 1 AND 3);
EXCEPTION
  WHEN undefined_table THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE event_settings ALTER COLUMN max_team_members SET DEFAULT 3;
  UPDATE event_settings SET max_team_members = 3 WHERE id = 1 AND max_team_members = 2;
EXCEPTION
  WHEN undefined_table THEN null;
END $$;

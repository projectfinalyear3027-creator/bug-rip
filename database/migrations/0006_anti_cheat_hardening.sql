-- =============================================================================
-- Migration 0006: Anti-Cheat & Participant Hardening (Fragment 12)
-- Expands anti_cheat_event_type enum and adds review/evidence fields
-- =============================================================================

ALTER TYPE anti_cheat_event_type ADD VALUE IF NOT EXISTS 'TAB_VISIBLE';
ALTER TYPE anti_cheat_event_type ADD VALUE IF NOT EXISTS 'WINDOW_FOCUS';
ALTER TYPE anti_cheat_event_type ADD VALUE IF NOT EXISTS 'FULLSCREEN_ENTER';
ALTER TYPE anti_cheat_event_type ADD VALUE IF NOT EXISTS 'RELOAD';
ALTER TYPE anti_cheat_event_type ADD VALUE IF NOT EXISTS 'RECONNECT';
ALTER TYPE anti_cheat_event_type ADD VALUE IF NOT EXISTS 'MULTI_SESSION_ATTEMPT';
ALTER TYPE anti_cheat_event_type ADD VALUE IF NOT EXISTS 'SESSION_REJECTED';
ALTER TYPE anti_cheat_event_type ADD VALUE IF NOT EXISTS 'HEARTBEAT_TIMEOUT';
ALTER TYPE anti_cheat_event_type ADD VALUE IF NOT EXISTS 'COPY_PASTE_FLAG';

ALTER TYPE anti_cheat_action ADD VALUE IF NOT EXISTS 'LOGGED';
ALTER TYPE anti_cheat_action ADD VALUE IF NOT EXISTS 'VERIFIED_CLEAR';
ALTER TYPE anti_cheat_action ADD VALUE IF NOT EXISTS 'FLAGGED_VIOLATION';

-- Add admin review and evidence preservation fields to anti_cheat_events
ALTER TABLE anti_cheat_events ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES admin_users(id) ON DELETE SET NULL;
ALTER TABLE anti_cheat_events ADD COLUMN IF NOT EXISTS admin_notes TEXT;
ALTER TABLE anti_cheat_events ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

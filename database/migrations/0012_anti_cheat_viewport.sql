-- =============================================================================
-- Migration 0012: Anti-Cheat Viewport Tracking & Integrity Refinement
-- Expands anti_cheat_event_type enum to include VIEWPORT_CHANGE and VIEWPORT_RESIZE
-- =============================================================================

ALTER TYPE anti_cheat_event_type ADD VALUE IF NOT EXISTS 'VIEWPORT_CHANGE';
ALTER TYPE anti_cheat_event_type ADD VALUE IF NOT EXISTS 'VIEWPORT_RESIZE';

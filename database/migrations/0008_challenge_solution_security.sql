-- Migration 0008: Add solution_code and admin_notes to challenges table
-- STRICT SECURITY MANDATE: solution_code and admin_notes are private admin/worker fields.
-- They must NEVER be selected or returned in participant-facing APIs or queries.

ALTER TABLE challenges ADD COLUMN IF NOT EXISTS solution_code TEXT;
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS admin_notes TEXT;

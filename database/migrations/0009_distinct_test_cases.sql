-- Migration 0009: Distinct Challenge Test Cases & Anti-Duplication Constraint
-- Adds explanation column, cleans up duplicate historical rows, and enforces unique order per challenge test tier.

ALTER TABLE challenge_test_cases ADD COLUMN IF NOT EXISTS explanation TEXT;

-- Deduplicate any existing duplicate test cases keeping the earliest created entry
DELETE FROM challenge_test_cases
WHERE id NOT IN (
  SELECT DISTINCT ON (challenge_id, is_hidden, display_order) id
  FROM challenge_test_cases
  ORDER BY challenge_id, is_hidden, display_order, created_at ASC
);

-- Enforce unique index on (challenge_id, is_hidden, display_order)
CREATE UNIQUE INDEX IF NOT EXISTS idx_test_cases_order_uq 
ON challenge_test_cases(challenge_id, is_hidden, display_order);

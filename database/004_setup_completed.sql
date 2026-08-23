-- =============================================================================
-- Migration 004: track advisor setup concierge completion
-- Run after 001_init.sql (and 003 if applicable)
-- =============================================================================

ALTER TABLE advisor_financial_profile
  ADD COLUMN IF NOT EXISTS setup_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN advisor_financial_profile.setup_completed_at IS
  'Set when the advisor completes the in-app setup concierge (monthly goal required)';

SELECT 'Migration 004: setup_completed_at applied.' AS message;

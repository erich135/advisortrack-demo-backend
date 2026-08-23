-- =============================================================================
-- Migration 005: record Terms of Service acceptance on user accounts
-- Run after 001_init.sql
-- =============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terms_version VARCHAR(16);

COMMENT ON COLUMN users.terms_accepted_at IS 'When the advisor accepted Terms of Service during setup';
COMMENT ON COLUMN users.terms_version IS 'Version string of the accepted terms document';

SELECT 'Migration 005: terms acceptance columns applied.' AS message;

-- =============================================================================
-- Migration 006: adaptive conversion ratios (monthly recalculation from activity)
-- Run after 001_init.sql
-- =============================================================================

ALTER TABLE advisor_general_settings
  ADD COLUMN IF NOT EXISTS adaptive_ratios_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS ratios_last_adjusted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ratios_adjustment_month CHAR(7);

COMMENT ON COLUMN advisor_general_settings.adaptive_ratios_enabled IS
  'When true, conversion ratios auto-update monthly from completed pipeline activity';
COMMENT ON COLUMN advisor_general_settings.ratios_last_adjusted_at IS
  'Timestamp of the last adaptive ratio recalculation';
COMMENT ON COLUMN advisor_general_settings.ratios_adjustment_month IS
  'YYYY-MM month key when ratios were last recalculated (prevents duplicate runs)';

SELECT 'Migration 006: adaptive ratio columns applied.' AS message;

-- Migration 014: Per-stage activity target dates on client cases
-- Run after 013_contact_client_fsp_vat.sql

ALTER TABLE client_cases
  ADD COLUMN IF NOT EXISTS stage_dates JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN client_cases.stage_dates IS
  'Map of pipeline stage name → YYYY-MM-DD target date; avoids overwriting dates when stages advance';

SELECT 'Migration 014: stage_dates column applied.' AS message;

-- Migration 015: Concierge planning — working schedule and commission split notes
-- Run after 014_stage_dates.sql

ALTER TABLE advisor_financial_profile
  ADD COLUMN IF NOT EXISTS working_weeks_per_year SMALLINT NOT NULL DEFAULT 44,
  ADD COLUMN IF NOT EXISTS working_days_per_week SMALLINT NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS commission_split_notes VARCHAR(255);

COMMENT ON COLUMN advisor_financial_profile.working_weeks_per_year IS
  'Active working weeks per year for activity target calculations (e.g. 44)';

COMMENT ON COLUMN advisor_financial_profile.working_days_per_week IS
  'Prospecting days per week — daily goals = weekly ÷ this value (e.g. 4–5)';

COMMENT ON COLUMN advisor_financial_profile.commission_split_notes IS
  'Partner / house description for the commission split (e.g. broker name)';

SELECT 'Migration 015: concierge planning fields applied.' AS message;

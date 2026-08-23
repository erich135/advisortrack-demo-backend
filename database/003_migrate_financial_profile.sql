-- =============================================================================
-- Migration: move financial profile fields off users → advisor_financial_profile
-- Run once on existing databases that already ran 001_init.sql (old version).
-- Safe to re-run (uses IF EXISTS / IF NOT EXISTS checks).
-- =============================================================================

BEGIN;

-- 1. New table
CREATE TABLE IF NOT EXISTS advisor_financial_profile (
  user_id                 UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  monthly_goal_nett       NUMERIC(14, 2),
  monthly_deductions      NUMERIC(14, 2),
  commission_split        VARCHAR(255),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE advisor_financial_profile IS 'Profile Settings financial fields — separate from core user identity';

-- 2. Migrate data from users (only if old columns still exist)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'monthly_goal_nett'
  ) THEN
    INSERT INTO advisor_financial_profile (
      user_id,
      monthly_goal_nett,
      monthly_deductions,
      commission_split
    )
    SELECT
      id,
      monthly_goal_nett,
      monthly_deductions,
      commission_split
    FROM users
    ON CONFLICT (user_id) DO UPDATE SET
      monthly_goal_nett = EXCLUDED.monthly_goal_nett,
      monthly_deductions = EXCLUDED.monthly_deductions,
      commission_split = EXCLUDED.commission_split,
      updated_at = NOW();

    ALTER TABLE users DROP COLUMN IF EXISTS monthly_goal_nett;
    ALTER TABLE users DROP COLUMN IF EXISTS monthly_deductions;
    ALTER TABLE users DROP COLUMN IF EXISTS commission_split;
  END IF;
END $$;

-- 3. Ensure every user has a financial profile row
INSERT INTO advisor_financial_profile (user_id)
SELECT u.id
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM advisor_financial_profile afp WHERE afp.user_id = u.id
);

-- 4. updated_at trigger on financial profile
DROP TRIGGER IF EXISTS trg_financial_profile_updated_at ON advisor_financial_profile;
CREATE TRIGGER trg_financial_profile_updated_at
  BEFORE UPDATE ON advisor_financial_profile
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- 5. Replace user insert trigger (general settings + financial profile)
DROP TRIGGER IF EXISTS trg_users_create_general_settings ON users;
DROP TRIGGER IF EXISTS trg_users_create_advisor_settings ON users;

CREATE OR REPLACE FUNCTION create_default_advisor_settings()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO advisor_general_settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO advisor_financial_profile (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_create_advisor_settings
  AFTER INSERT ON users
  FOR EACH ROW
  EXECUTE PROCEDURE create_default_advisor_settings();

COMMIT;

SELECT 'Migration 003: advisor_financial_profile applied.' AS message;

-- Migration 013: Contact Client status, advisor FSP number, VAT registration fields
-- Run after 012_johan_pipeline.sql

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'contact_status' AND e.enumlabel = 'client'
  ) THEN
    ALTER TYPE contact_status ADD VALUE 'client';
  END IF;
END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS fsp_number VARCHAR(32);

COMMENT ON COLUMN users.fsp_number IS 'FAIS Financial Services Provider number for the advisor';

ALTER TABLE advisor_financial_profile
  ADD COLUMN IF NOT EXISTS vat_registered BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS vat_rate_percent NUMERIC(5, 2) DEFAULT 15;

COMMENT ON COLUMN advisor_financial_profile.vat_registered IS 'Whether the advisor practice is a VAT vendor (SA 15%)';
COMMENT ON COLUMN advisor_financial_profile.vat_rate_percent IS 'Adjustable VAT rate until final product wording — default 15%';

SELECT 'Migration 013: client status, FSP, VAT fields applied.' AS message;

-- Migration 012: Johan pipeline requirements — FICA bank details, fact-find, quotes, multi-case, application status
-- Run after 011_practice_contacts_intro.sql

-- FICA: proof of bank details (was mislabeled consent — phase-1 consent is a separate document)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'client_cases'
      AND column_name = 'fica_consent_received'
  ) THEN
    ALTER TABLE client_cases RENAME COLUMN fica_consent_received TO fica_bank_received;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'client_cases'
      AND column_name = 'fica_bank_received'
  ) THEN
    ALTER TABLE client_cases
      ADD COLUMN fica_bank_received BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;

COMMENT ON COLUMN client_cases.fica_bank_received IS 'FICA — proof of bank details received';

ALTER TABLE client_cases
  ADD COLUMN IF NOT EXISTS fica_skip_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS fact_find_mode VARCHAR(16),
  ADD COLUMN IF NOT EXISTS simple_goal_product VARCHAR(64),
  ADD COLUMN IF NOT EXISTS simple_goal_amount NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS marital_status VARCHAR(32),
  ADD COLUMN IF NOT EXISTS dependents_notes TEXT,
  ADD COLUMN IF NOT EXISTS fixed_assets_total NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS non_fixed_assets_total NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS investments_total NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS liabilities_total NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS savings_monthly NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS employer_benefits_notes TEXT,
  ADD COLUMN IF NOT EXISTS business_interests_notes TEXT,
  ADD COLUMN IF NOT EXISTS retirement_funds_notes TEXT,
  ADD COLUMN IF NOT EXISTS life_cover_notes TEXT,
  ADD COLUMN IF NOT EXISTS estate_planning_notes TEXT,
  ADD COLUMN IF NOT EXISTS quotes_requested_notes TEXT,
  ADD COLUMN IF NOT EXISTS analysis_quotes JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS next_step_date DATE;

COMMENT ON COLUMN client_cases.fact_find_mode IS 'simple_goal | full_fna — null until fact-finding starts';
COMMENT ON COLUMN client_cases.analysis_quotes IS 'Up to 3 quote options during analysis (premium/commission per product)';
COMMENT ON COLUMN client_cases.next_step_date IS 'Next pipeline action date — surfaces on dashboard upcoming events';

-- Allow multiple open cases per contact (duplicate for 2nd/3rd product)
DROP INDEX IF EXISTS idx_client_cases_one_open_per_contact;

CREATE INDEX IF NOT EXISTS idx_client_cases_user_contact_open
  ON client_cases(user_id, contact_id)
  WHERE status = 'open';

-- Application tracking between submission and issued
ALTER TABLE production_entries
  ADD COLUMN IF NOT EXISTS application_status VARCHAR(48);

COMMENT ON COLUMN production_entries.application_status IS
  'Underwriting lifecycle — income counts when accepted_issued or is_issued';

-- Relabel existing phase-1 document placeholders where possible
UPDATE case_documents
SET label = 'Broker disclosure'
WHERE document_type = 'fais_disclosure';

UPDATE case_documents
SET label = 'Letter of appointment'
WHERE document_type = 'service_agreement';

SELECT 'Migration 012: Johan pipeline fields applied.' AS message;

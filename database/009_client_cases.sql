-- Migration 009: Client cases (6-step pipeline), FICA flags, documents, fact-find
-- Run after 008_subscriptions.sql

CREATE TYPE case_status AS ENUM ('open', 'won', 'lost', 'closed');

CREATE TABLE IF NOT EXISTS client_cases (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id                  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  current_stage               pipeline_stage NOT NULL DEFAULT 'Initial Contact',
  status                      case_status NOT NULL DEFAULT 'open',
  title                       VARCHAR(255),
  fica_id_received            BOOLEAN NOT NULL DEFAULT FALSE,
  fica_residence_received     BOOLEAN NOT NULL DEFAULT FALSE,
  fica_consent_received       BOOLEAN NOT NULL DEFAULT FALSE,
  consent_sent_at             TIMESTAMPTZ,
  monthly_income              NUMERIC(14, 2),
  monthly_expenses            NUMERIC(14, 2),
  financial_goals             TEXT,
  risk_profile                VARCHAR(32),
  fact_find_notes             TEXT,
  quote_product_type          VARCHAR(64),
  quote_premium               NUMERIC(14, 2),
  estimated_commission        NUMERIC(14, 2),
  replacement_advice_required BOOLEAN NOT NULL DEFAULT FALSE,
  replacement_advice_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  client_approved             BOOLEAN,
  review_due_at               DATE,
  linked_production_id        UUID,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE client_cases IS 'One active client journey per contact — 6-step FAIS pipeline';
COMMENT ON COLUMN client_cases.current_stage IS 'Non-linear lifecycle stage (maps to pipeline_stage enum)';

CREATE UNIQUE INDEX IF NOT EXISTS idx_client_cases_one_open_per_contact
  ON client_cases(user_id, contact_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_client_cases_user ON client_cases(user_id);
CREATE INDEX IF NOT EXISTS idx_client_cases_contact ON client_cases(contact_id);

CREATE TABLE IF NOT EXISTS case_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         UUID NOT NULL REFERENCES client_cases(id) ON DELETE CASCADE,
  document_type   VARCHAR(64) NOT NULL DEFAULT 'other',
  label           VARCHAR(255) NOT NULL,
  sent_at         TIMESTAMPTZ,
  received_at     TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_documents_case ON case_documents(case_id);

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS case_id UUID REFERENCES client_cases(id) ON DELETE SET NULL;

ALTER TABLE production_entries
  ADD COLUMN IF NOT EXISTS case_id UUID REFERENCES client_cases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_activities_case_id ON activities(case_id);
CREATE INDEX IF NOT EXISTS idx_production_entries_case_id ON production_entries(case_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_cases_linked_production_fkey'
  ) THEN
    ALTER TABLE client_cases
      ADD CONSTRAINT client_cases_linked_production_fkey
      FOREIGN KEY (linked_production_id) REFERENCES production_entries(id) ON DELETE SET NULL;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_client_cases_updated_at ON client_cases;
CREATE TRIGGER trg_client_cases_updated_at
  BEFORE UPDATE ON client_cases
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

DROP TRIGGER IF EXISTS trg_case_documents_updated_at ON case_documents;
CREATE TRIGGER trg_case_documents_updated_at
  BEFORE UPDATE ON case_documents
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

SELECT 'Migration 009: client_cases applied.' AS message;

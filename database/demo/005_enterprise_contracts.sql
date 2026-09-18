-- DEMO ONLY. Isolated advisortrack_demo. Never production.
-- Enterprise commercial contracts for simulated Northstar billing.
-- Additive new tables. Does not alter Android-facing users or companies columns.

CREATE TABLE IF NOT EXISTS enterprise_contracts (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                      UUID REFERENCES companies(id) ON DELETE RESTRICT,
  onboarding_id                   UUID,
  commercial_status               VARCHAR(16) NOT NULL DEFAULT 'lead',
  contract_start_date             DATE,
  contract_end_date               DATE,
  auto_renew                      BOOLEAN NOT NULL DEFAULT FALSE,
  committed_licences              INTEGER,
  billing_model                   VARCHAR(16) NOT NULL DEFAULT 'monthly',
  billing_frequency               VARCHAR(16) NOT NULL DEFAULT 'monthly',
  pricing_basis                   VARCHAR(16) NOT NULL DEFAULT 'per_seat',
  negotiated_unit_price_cents     INTEGER,
  negotiated_fixed_amount_cents   INTEGER,
  currency                        CHAR(3) NOT NULL DEFAULT 'ZAR',
  vat_applicable                  BOOLEAN NOT NULL DEFAULT FALSE,
  vat_rate_percent                NUMERIC(5, 2) NOT NULL DEFAULT 0,
  payment_terms_code              VARCHAR(24) NOT NULL DEFAULT 'days_30',
  payment_terms_custom            TEXT,
  po_reference                    VARCHAR(64),
  billing_contact_name            VARCHAR(200),
  billing_email                   VARCHAR(255),
  billing_notes                   TEXT,
  internal_notes                  TEXT,
  additional_seat_policy          VARCHAR(32) NOT NULL DEFAULT 'next_invoice',
  seat_reduction_policy           VARCHAR(32) NOT NULL DEFAULT 'renewal_only',
  created_by_user_id              UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT enterprise_contracts_status_check
    CHECK (commercial_status IN ('lead', 'onboarding', 'active', 'suspended', 'cancelled', 'expired')),
  CONSTRAINT enterprise_contracts_billing_model_check
    CHECK (billing_model IN ('monthly', 'annual', 'custom')),
  CONSTRAINT enterprise_contracts_billing_frequency_check
    CHECK (billing_frequency IN ('monthly', 'quarterly', 'annual', 'custom')),
  CONSTRAINT enterprise_contracts_pricing_basis_check
    CHECK (pricing_basis IN ('per_seat', 'fixed_amount', 'custom')),
  CONSTRAINT enterprise_contracts_payment_terms_check
    CHECK (payment_terms_code IN ('due_on_receipt', 'days_7', 'days_15', 'days_30', 'custom')),
  CONSTRAINT enterprise_contracts_seat_increase_check
    CHECK (additional_seat_policy IN (
      'immediate_proration', 'next_invoice', 'quarterly_true_up', 'annual_true_up', 'manual_review'
    )),
  CONSTRAINT enterprise_contracts_seat_reduction_check
    CHECK (seat_reduction_policy IN ('immediate', 'next_billing_cycle', 'renewal_only', 'manual_review')),
  CONSTRAINT enterprise_contracts_vat_off_check
    CHECK (vat_applicable = FALSE)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_enterprise_contracts_company
  ON enterprise_contracts (company_id)
  WHERE company_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS enterprise_contract_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id      UUID NOT NULL REFERENCES enterprise_contracts(id) ON DELETE RESTRICT,
  event_type       VARCHAR(40) NOT NULL,
  changed_fields   JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO enterprise_contracts (
  company_id, commercial_status, contract_start_date, contract_end_date, auto_renew,
  committed_licences, billing_model, billing_frequency, pricing_basis,
  negotiated_unit_price_cents, currency, vat_applicable, vat_rate_percent,
  payment_terms_code, po_reference, billing_contact_name, billing_email,
  billing_notes, internal_notes, additional_seat_policy, seat_reduction_policy,
  created_by_user_id
)
SELECT
  c.id, 'active', '2026-09-01', '2027-08-31', TRUE,
  50, 'annual', 'annual', 'per_seat',
  7500, 'ZAR', FALSE, 0,
  'days_30', 'NS-ENT-2026', 'Northstar Finance', 'finance@northstar.demo.invalid',
  'AdvisorTrack Enterprise annual agreement for Northstar Advisory.',
  'Demo internal commercial notes. Never return on customer APIs.',
  'next_invoice', 'renewal_only',
  u.id
FROM companies c
CROSS JOIN LATERAL (
  SELECT id FROM users ORDER BY created_at LIMIT 1
) u
WHERE c.slug = 'northstar-advisory-master'
  AND NOT EXISTS (
    SELECT 1 FROM enterprise_contracts existing WHERE existing.company_id = c.id
  );

-- DEMO ONLY. Isolated advisortrack_demo. Never production.
-- Task 13 additional licences / seat-increase workflow.
-- Creates licence_increase_requests (demo never had Task 6 table) plus
-- append-only seat-change ledger and billing adjustments.
-- Operational purchased pool remains companies.seat_limit.

CREATE TABLE IF NOT EXISTS licence_increase_requests (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contract_id                  UUID REFERENCES enterprise_contracts(id) ON DELETE RESTRICT,
  requested_by_user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  current_purchased            INTEGER,
  additional_requested         INTEGER NOT NULL,
  proposed_total               INTEGER,
  expected_previous_purchased  INTEGER,
  status                       VARCHAR(24) NOT NULL DEFAULT 'pending',
  billing_treatment            VARCHAR(32),
  notes                        TEXT,
  decision                     VARCHAR(24),
  decision_notes               TEXT,
  billing_amount_cents         INTEGER,
  reviewed_by_user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at                  TIMESTAMPTZ,
  applied_at                   TIMESTAMPTZ,
  cancelled_at                 TIMESTAMPTZ,
  cancelled_by_user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT licence_increase_additional_check CHECK (additional_requested > 0),
  CONSTRAINT licence_increase_status_check
    CHECK (status IN ('queued_local', 'submitted', 'pending', 'approved', 'rejected', 'cancelled', 'applied')),
  CONSTRAINT licence_increase_decision_check
    CHECK (decision IS NULL OR decision IN ('approved', 'rejected', 'cancelled')),
  CONSTRAINT licence_increase_treatment_check
    CHECK (
      billing_treatment IS NULL OR billing_treatment IN (
        'immediate_proration', 'next_invoice', 'quarterly_true_up', 'annual_true_up', 'manual_review'
      )
    )
);

CREATE INDEX IF NOT EXISTS idx_licence_increase_company
  ON licence_increase_requests (company_id, created_at DESC);

COMMENT ON TABLE licence_increase_requests IS
  'Customer licence increase requests. Does not write companies.seat_limit until applied.';
COMMENT ON COLUMN licence_increase_requests.decision_notes IS
  'Internal review notes. Never returned on customer APIs.';

ALTER TABLE enterprise_contracts
  ADD COLUMN IF NOT EXISTS additional_seats_auto_activate BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN enterprise_contracts.additional_seats_auto_activate IS
  'When TRUE, an Organisation Admin request may apply immediately. Default FALSE.';

CREATE TABLE IF NOT EXISTS enterprise_contract_seat_changes (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                 UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  contract_id                UUID REFERENCES enterprise_contracts(id) ON DELETE RESTRICT,
  request_id                 UUID REFERENCES licence_increase_requests(id) ON DELETE RESTRICT,
  previous_purchased_seats   INTEGER NOT NULL,
  delta                      INTEGER NOT NULL,
  new_purchased_seats        INTEGER NOT NULL,
  effective_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  billing_treatment          VARCHAR(32) NOT NULL,
  commercial_reference       TEXT,
  actor_user_id              UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT enterprise_seat_change_delta_check CHECK (delta <> 0),
  CONSTRAINT enterprise_seat_change_qty_check CHECK (previous_purchased_seats >= 0 AND new_purchased_seats >= 0),
  CONSTRAINT enterprise_seat_change_treatment_check
    CHECK (billing_treatment IN (
      'immediate_proration', 'next_invoice', 'quarterly_true_up', 'annual_true_up', 'manual_review'
    ))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_enterprise_seat_change_request
  ON enterprise_contract_seat_changes (request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_enterprise_seat_changes_company
  ON enterprise_contract_seat_changes (company_id, effective_at DESC);

CREATE TABLE IF NOT EXISTS enterprise_billing_adjustments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  contract_id          UUID REFERENCES enterprise_contracts(id) ON DELETE RESTRICT,
  seat_change_id       UUID REFERENCES enterprise_contract_seat_changes(id) ON DELETE RESTRICT,
  request_id           UUID REFERENCES licence_increase_requests(id) ON DELETE RESTRICT,
  invoice_id           UUID REFERENCES invoices(id) ON DELETE SET NULL,
  adjustment_type      VARCHAR(32) NOT NULL,
  status               VARCHAR(24) NOT NULL DEFAULT 'pending',
  amount_cents         INTEGER,
  vat_amount_cents     INTEGER NOT NULL DEFAULT 0,
  currency             CHAR(3) NOT NULL DEFAULT 'ZAR',
  period_start         DATE,
  period_end           DATE,
  description          TEXT,
  actor_user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT enterprise_billing_adj_type_check
    CHECK (adjustment_type IN (
      'immediate_proration', 'next_invoice', 'quarterly_true_up', 'annual_true_up', 'manual_review'
    )),
  CONSTRAINT enterprise_billing_adj_status_check
    CHECK (status IN ('pending', 'recorded', 'included', 'waived', 'cancelled')),
  CONSTRAINT enterprise_billing_adj_vat_lock CHECK (vat_amount_cents = 0),
  CONSTRAINT enterprise_billing_adj_currency_check CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_enterprise_billing_adj_seat_change
  ON enterprise_billing_adjustments (seat_change_id)
  WHERE seat_change_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_enterprise_billing_adj_company
  ON enterprise_billing_adjustments (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enterprise_billing_adj_pending
  ON enterprise_billing_adjustments (company_id, status)
  WHERE invoice_id IS NULL AND status IN ('pending', 'recorded');

DROP TRIGGER IF EXISTS trg_licence_increase_requests_updated_at ON licence_increase_requests;
CREATE TRIGGER trg_licence_increase_requests_updated_at
  BEFORE UPDATE ON licence_increase_requests
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

DROP TRIGGER IF EXISTS trg_enterprise_billing_adjustments_updated_at ON enterprise_billing_adjustments;
CREATE TRIGGER trg_enterprise_billing_adjustments_updated_at
  BEFORE UPDATE ON enterprise_billing_adjustments
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

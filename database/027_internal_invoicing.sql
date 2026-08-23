-- 027: Internal AdvisorTrack invoicing (web admin only).
-- Additive new tables only. Does not alter Android-dependent companies, users,
-- user_subscriptions, or subscription_packages structures.
-- Business records are never hard-deleted: void/cancel/archive via status.

CREATE SEQUENCE IF NOT EXISTS invoice_number_seq
  AS BIGINT
  START WITH 100000
  INCREMENT BY 1
  NO CYCLE;

CREATE TABLE IF NOT EXISTS company_billing_profiles (
  company_id             UUID PRIMARY KEY REFERENCES companies(id) ON DELETE RESTRICT,
  registered_name        VARCHAR(200) NOT NULL,
  trading_name           VARCHAR(200),
  registration_number    VARCHAR(64),
  vat_registered         BOOLEAN NOT NULL DEFAULT FALSE,
  vat_number             VARCHAR(32),
  vat_rate_percent       NUMERIC(5, 2) DEFAULT 15,
  billing_contact_name   VARCHAR(200),
  billing_email          VARCHAR(255),
  telephone              VARCHAR(30),
  address                TEXT,
  city                   VARCHAR(100),
  province               VARCHAR(100),
  postal_code            VARCHAR(16),
  country                VARCHAR(100) DEFAULT 'South Africa',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE company_billing_profiles IS
  'Customer billing details for AdvisorTrack invoicing. Separate from Android company records.';
COMMENT ON COLUMN company_billing_profiles.vat_number IS
  'Required only when vat_registered is true at invoice issue time. Optional otherwise.';

CREATE TABLE IF NOT EXISTS invoices (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                 UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  invoice_seq                BIGINT NOT NULL UNIQUE,
  invoice_number             VARCHAR(32) NOT NULL UNIQUE,
  status                     VARCHAR(16) NOT NULL DEFAULT 'draft',
  invoice_date               DATE NOT NULL,
  due_date                   DATE NOT NULL,
  po_reference               VARCHAR(64),
  notes                      TEXT,
  payment_terms              TEXT,
  currency                   CHAR(3) NOT NULL DEFAULT 'ZAR',
  snapshot_registered_name   VARCHAR(200) NOT NULL,
  snapshot_trading_name      VARCHAR(200),
  snapshot_registration_number VARCHAR(64),
  snapshot_vat_registered    BOOLEAN NOT NULL DEFAULT FALSE,
  snapshot_vat_number        VARCHAR(32),
  snapshot_billing_contact_name VARCHAR(200),
  snapshot_billing_email     VARCHAR(255),
  snapshot_telephone         VARCHAR(30),
  snapshot_address           TEXT,
  snapshot_city              VARCHAR(100),
  snapshot_province          VARCHAR(100),
  snapshot_postal_code       VARCHAR(16),
  snapshot_country           VARCHAR(100),
  snapshot_plan_slug         VARCHAR(64),
  snapshot_plan_name         VARCHAR(128),
  subtotal_cents             INTEGER NOT NULL DEFAULT 0,
  vat_cents                  INTEGER NOT NULL DEFAULT 0,
  total_cents                INTEGER NOT NULL DEFAULT 0,
  paid_at                    TIMESTAMPTZ,
  payment_date               DATE,
  issued_at                  TIMESTAMPTZ,
  cancelled_at               TIMESTAMPTZ,
  voided_at                  TIMESTAMPTZ,
  duplicated_from_invoice_id UUID REFERENCES invoices(id) ON DELETE RESTRICT,
  created_by_user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT invoices_status_check
    CHECK (status IN ('draft', 'sent', 'paid', 'cancelled', 'voided')),
  CONSTRAINT invoices_number_format_check
    CHECK (invoice_number ~ '^INV[0-9]{6,}$'),
  CONSTRAINT invoices_totals_non_negative_check
    CHECK (subtotal_cents >= 0 AND vat_cents >= 0 AND total_cents >= 0)
);

COMMENT ON TABLE invoices IS
  'Internal AdvisorTrack customer invoices. Numbers are sequential INV100000+. Never hard-deleted.';
COMMENT ON COLUMN invoices.invoice_seq IS
  'Atomic invoice sequence value from invoice_number_seq. Never reused.';
COMMENT ON COLUMN invoices.invoice_number IS
  'Visible invoice number: INV + sequence (INV100000, INV100001, …).';
COMMENT ON COLUMN invoices.status IS
  'Stored lifecycle: draft | sent | paid | cancelled | voided. Overdue is calculated from sent + due_date.';

CREATE INDEX IF NOT EXISTS idx_invoices_company_created
  ON invoices(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_status
  ON invoices(status);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id          UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  description         VARCHAR(500) NOT NULL,
  quantity            NUMERIC(12, 4) NOT NULL,
  unit_price_cents    INTEGER NOT NULL,
  discount_cents      INTEGER NOT NULL DEFAULT 0,
  vat_rate_percent    NUMERIC(5, 2) NOT NULL DEFAULT 0,
  line_subtotal_cents INTEGER NOT NULL,
  line_vat_cents      INTEGER NOT NULL,
  line_total_cents    INTEGER NOT NULL,
  is_current          BOOLEAN NOT NULL DEFAULT TRUE,
  replaced_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT invoice_line_items_quantity_check CHECK (quantity > 0),
  CONSTRAINT invoice_line_items_price_check CHECK (unit_price_cents >= 0),
  CONSTRAINT invoice_line_items_discount_check CHECK (discount_cents >= 0)
);

COMMENT ON TABLE invoice_line_items IS
  'Invoice lines. Draft edits supersede lines (is_current=false) instead of deleting them.';

CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice
  ON invoice_line_items(invoice_id, is_current, sort_order);

CREATE TABLE IF NOT EXISTS invoice_status_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  from_status     VARCHAR(16),
  to_status       VARCHAR(16) NOT NULL,
  actor_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE invoice_status_events IS
  'Invoice lifecycle history. Retained after cancel/void. Never hard-deleted.';

CREATE INDEX IF NOT EXISTS idx_invoice_status_events_invoice
  ON invoice_status_events(invoice_id, created_at DESC);

-- Prepared for Phase 8 email delivery. Unused in Phase 7 besides empty reads.
CREATE TABLE IF NOT EXISTS invoice_delivery_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id       UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  channel          VARCHAR(16) NOT NULL DEFAULT 'email',
  status           VARCHAR(16) NOT NULL DEFAULT 'queued',
  recipient_email  VARCHAR(255),
  actor_user_id    UUID REFERENCES users(id) ON DELETE RESTRICT,
  error_message    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT invoice_delivery_events_status_check
    CHECK (status IN ('queued', 'sent', 'failed'))
);

COMMENT ON TABLE invoice_delivery_events IS
  'Prepared for Phase 8 invoice email delivery. Phase 7 does not send mail.';

DROP TRIGGER IF EXISTS trg_company_billing_profiles_updated_at ON company_billing_profiles;
CREATE TRIGGER trg_company_billing_profiles_updated_at
  BEFORE UPDATE ON company_billing_profiles
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

DROP TRIGGER IF EXISTS trg_invoices_updated_at ON invoices;
CREATE TRIGGER trg_invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

SELECT 'Migration 027: internal invoicing applied.' AS message;

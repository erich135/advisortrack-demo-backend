-- 026: Company commercial subscription record for internal AdvisorTrack administration.
-- Purchased capacity remains companies.seat_limit (Phase 5). Assigned/available stay computed.
-- Per-user entitlements remain user_subscriptions. Distinct from companies.is_active (account status).
-- A separate 1:1 table is used because companies has no columns that can hold plan, billing,
-- VAT treatment, billing contact, or company subscription status.

CREATE TABLE IF NOT EXISTS company_subscriptions (
  company_id               UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  status                   VARCHAR(32) NOT NULL DEFAULT 'active',
  package_id               UUID REFERENCES subscription_packages(id),
  started_at               TIMESTAMPTZ,
  next_billing_at          TIMESTAMPTZ,
  vat_registered           BOOLEAN NOT NULL DEFAULT FALSE,
  vat_rate_percent         NUMERIC(5, 2) DEFAULT 15,
  billing_contact_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  billing_contact_name     VARCHAR(200),
  billing_contact_email    VARCHAR(255),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_subscriptions_status_check
    CHECK (status IN ('active', 'suspended', 'cancelled'))
);

COMMENT ON TABLE company_subscriptions IS
  'Customer commercial subscription administered by AdvisorTrack staff. Not a licence pool.';
COMMENT ON COLUMN company_subscriptions.status IS
  'Company commercial subscription: active | suspended | cancelled. Distinct from companies.is_active.';
COMMENT ON COLUMN company_subscriptions.package_id IS
  'Contracted commercial plan. User licence rows remain in user_subscriptions.';
COMMENT ON COLUMN company_subscriptions.started_at IS
  'When the current commercial subscription was first activated.';
COMMENT ON COLUMN company_subscriptions.next_billing_at IS
  'Renewal / next billing date for the company subscription.';
COMMENT ON COLUMN company_subscriptions.vat_registered IS
  'Whether the customer organisation is a VAT vendor for AdvisorTrack billing.';
COMMENT ON COLUMN company_subscriptions.vat_rate_percent IS
  'VAT rate used for company billing when VAT-registered. Default 15.';
COMMENT ON COLUMN company_subscriptions.billing_contact_user_id IS
  'Optional company member designated as billing contact.';

CREATE INDEX IF NOT EXISTS idx_company_subscriptions_package
  ON company_subscriptions(package_id);
CREATE INDEX IF NOT EXISTS idx_company_subscriptions_billing_contact
  ON company_subscriptions(billing_contact_user_id);

DROP TRIGGER IF EXISTS trg_company_subscriptions_updated_at ON company_subscriptions;
CREATE TRIGGER trg_company_subscriptions_updated_at
  BEFORE UPDATE ON company_subscriptions
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

SELECT 'Migration 026: company subscriptions applied.' AS message;

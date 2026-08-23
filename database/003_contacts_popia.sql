-- =============================================================================
-- AdvisorTrack — contact POPIA security columns + audit log
-- Run AFTER 001_init.sql (and 002_seed.sql if used)
-- =============================================================================

-- One-way fingerprints for deduplication (not reversible)
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS email_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS phone_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS contact_fingerprint VARCHAR(64),
  ADD COLUMN IF NOT EXISTS email_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS phone_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS id_number_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS address_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS notes_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS consent_recorded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS import_source VARCHAR(32) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS popia_notice_version VARCHAR(16);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_user_fingerprint
  ON contacts(user_id, contact_fingerprint)
  WHERE contact_fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_user_email_hash
  ON contacts(user_id, email_hash)
  WHERE email_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_user_phone_hash
  ON contacts(user_id, phone_hash)
  WHERE phone_hash IS NOT NULL;

COMMENT ON COLUMN contacts.email_hash IS 'HMAC fingerprint of normalized email — dedup only, not reversible';
COMMENT ON COLUMN contacts.phone_hash IS 'HMAC fingerprint of normalized phone — dedup only, not reversible';
COMMENT ON COLUMN contacts.contact_fingerprint IS 'Combined fingerprint for import deduplication';
COMMENT ON COLUMN contacts.consent_recorded_at IS 'When the advisor recorded POPIA consent for this contact record';
COMMENT ON COLUMN contacts.import_source IS 'manual | device_import';

-- POPIA audit trail — imports, bulk operations (no PII in metadata)
CREATE TABLE IF NOT EXISTS popia_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action          VARCHAR(64) NOT NULL,
  resource_type   VARCHAR(32) NOT NULL DEFAULT 'contact',
  resource_count  INTEGER,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_popia_audit_user_created
  ON popia_audit_log(user_id, created_at DESC);

COMMENT ON TABLE popia_audit_log IS 'POPIA accountability — records data processing events without storing subject PII';

SELECT 'POPIA contact security migration applied.' AS message;

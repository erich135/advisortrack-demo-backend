-- Demo-only. Apply exclusively to advisortrack_demo.
-- Anonymous public-demo visitor sessions. Expire/archive only; never hard-delete.

CREATE TABLE IF NOT EXISTS demo_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash     VARCHAR(64) NOT NULL UNIQUE,
  company_id     UUID REFERENCES companies(id),
  selected_role  VARCHAR(32),
  status         VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL,
  CONSTRAINT demo_sessions_status_check
    CHECK (status IN ('active', 'expired', 'archived')),
  CONSTRAINT demo_sessions_role_check
    CHECK (selected_role IS NULL OR selected_role IN ('executive', 'regional_manager', 'team_leader'))
);

COMMENT ON TABLE demo_sessions IS
  'Public-demo visitor sessions. One session maps to one isolated demo company. Never hard-deleted.';
COMMENT ON COLUMN demo_sessions.token_hash IS
  'SHA-256 hex of the opaque session token. Raw token is never stored.';
COMMENT ON COLUMN demo_sessions.company_id IS
  'Visitor company derived by the server from this session. Do not trust a client-supplied companyId.';
COMMENT ON COLUMN demo_sessions.selected_role IS
  'Filled when Phase 11 implements public role selection. Executive | Regional Manager | Team Leader only.';
COMMENT ON COLUMN demo_sessions.status IS
  'active | expired | archived. Expired sessions remain retained.';

CREATE INDEX IF NOT EXISTS idx_demo_sessions_company_id ON demo_sessions (company_id);
CREATE INDEX IF NOT EXISTS idx_demo_sessions_status_expires ON demo_sessions (status, expires_at);

-- Historic sample advisor from 001_init.sql is not the public demo organisation.
-- Deactivate rather than delete.
UPDATE users
SET is_active = FALSE, updated_at = NOW()
WHERE email = 'john.mitchell@advisortrack.com'
  AND COALESCE(is_active, TRUE) = TRUE;

-- 023: Companies (organisations), custom roles, and permissions.
-- New sign-ups join the platform company (AdvisorTrack) with the default Advisor role.
-- users.company (VARCHAR) remains the advisor's practice name on their profile.

CREATE TABLE IF NOT EXISTS companies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(200) NOT NULL,
  slug            VARCHAR(64) NOT NULL UNIQUE,
  seat_limit      INT,
  is_platform     BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE companies IS 'Organisations that hold advisor seats. New users join the platform company until invited elsewhere.';
COMMENT ON COLUMN companies.seat_limit IS 'Purchased seats. NULL means unlimited. Enforcement comes later.';
COMMENT ON COLUMN companies.is_platform IS 'True only for AdvisorTrack itself — the default home for self-serve sign-ups.';

CREATE TABLE IF NOT EXISTS company_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  is_system   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, name)
);

COMMENT ON TABLE company_roles IS 'Per-company role names (e.g. Supervisor, Manager). Permissions are attached separately.';
COMMENT ON COLUMN company_roles.is_default IS 'Assigned automatically when a user joins this company';
COMMENT ON COLUMN company_roles.is_system IS 'Seeded roles that cannot be deleted (they can be renamed)';

CREATE TABLE IF NOT EXISTS company_role_permissions (
  role_id         UUID NOT NULL REFERENCES company_roles(id) ON DELETE CASCADE,
  permission_key  VARCHAR(64) NOT NULL,
  PRIMARY KEY (role_id, permission_key)
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id),
  ADD COLUMN IF NOT EXISTS company_role_id UUID REFERENCES company_roles(id),
  ADD COLUMN IF NOT EXISTS reports_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_users_reports_to ON users(reports_to_user_id);
CREATE INDEX IF NOT EXISTS idx_company_roles_company ON company_roles(company_id);

COMMENT ON COLUMN users.company_id IS 'Organisation this advisor belongs to';
COMMENT ON COLUMN users.company_role_id IS 'Custom role within that organisation';
COMMENT ON COLUMN users.reports_to_user_id IS 'Optional manager — used later for team-scoped visibility';
COMMENT ON COLUMN users.is_platform_admin IS 'AdvisorTrack staff — can list all companies via /platform APIs';

DROP TRIGGER IF EXISTS trg_companies_updated_at ON companies;
CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

DROP TRIGGER IF EXISTS trg_company_roles_updated_at ON company_roles;
CREATE TRIGGER trg_company_roles_updated_at
  BEFORE UPDATE ON company_roles
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- Default home for self-serve registration
INSERT INTO companies (name, slug, seat_limit, is_platform, is_active)
VALUES ('AdvisorTrack', 'advisortrack', NULL, TRUE, TRUE)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  is_platform = TRUE,
  is_active = TRUE,
  updated_at = NOW();

INSERT INTO company_roles (company_id, name, is_default, is_system)
SELECT id, 'Advisor', TRUE, TRUE FROM companies WHERE slug = 'advisortrack'
ON CONFLICT (company_id, name) DO NOTHING;

INSERT INTO company_roles (company_id, name, is_default, is_system)
SELECT id, 'Company admin', FALSE, TRUE FROM companies WHERE slug = 'advisortrack'
ON CONFLICT (company_id, name) DO NOTHING;

-- Advisor: own work only (no extra keys)
-- Company admin: see company, manage roles and members
INSERT INTO company_role_permissions (role_id, permission_key)
SELECT r.id, p.permission_key
FROM company_roles r
JOIN companies c ON c.id = r.company_id
CROSS JOIN (
  VALUES
    ('view_company'),
    ('view_team'),
    ('manage_roles'),
    ('manage_members'),
    ('manage_company')
) AS p(permission_key)
WHERE c.slug = 'advisortrack'
  AND r.name = 'Company admin'
ON CONFLICT DO NOTHING;

-- Assigns the platform company + default Advisor role when company_id is omitted.
CREATE OR REPLACE FUNCTION assign_default_company()
RETURNS TRIGGER AS $$
DECLARE
  platform_id UUID;
  default_role_id UUID;
BEGIN
  IF NEW.company_id IS NULL THEN
    SELECT id INTO platform_id FROM companies WHERE is_platform = TRUE AND is_active = TRUE LIMIT 1;
    NEW.company_id := platform_id;

    SELECT id INTO default_role_id
    FROM company_roles
    WHERE company_id = platform_id AND is_default = TRUE
    LIMIT 1;

    NEW.company_role_id := default_role_id;
  ELSIF NEW.company_role_id IS NULL THEN
    SELECT id INTO default_role_id
    FROM company_roles
    WHERE company_id = NEW.company_id AND is_default = TRUE
    LIMIT 1;

    NEW.company_role_id := default_role_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_default_company ON users;
CREATE TRIGGER trg_users_default_company
  BEFORE INSERT ON users
  FOR EACH ROW
  EXECUTE PROCEDURE assign_default_company();

-- Attach any existing users to AdvisorTrack / Advisor
UPDATE users u
SET
  company_id = c.id,
  company_role_id = r.id
FROM companies c
JOIN company_roles r ON r.company_id = c.id AND r.is_default = TRUE
WHERE c.slug = 'advisortrack'
  AND u.company_id IS NULL;

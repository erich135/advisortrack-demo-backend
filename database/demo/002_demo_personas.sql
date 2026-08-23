-- Demo-only. Apply exclusively to advisortrack_demo.
-- Deterministic public-demo personas and the cloneable master workspace.
-- Never hard-delete. Archive/deactivate only.

CREATE TABLE IF NOT EXISTS demo_workspace_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL UNIQUE REFERENCES companies(id),
  status      VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT demo_workspace_templates_status_check
    CHECK (status IN ('active', 'archived'))
);

COMMENT ON TABLE demo_workspace_templates IS
  'Pristine fictional demo organisation. Visitors receive clones, never this company. Never hard-deleted.';

CREATE UNIQUE INDEX IF NOT EXISTS demo_workspace_templates_one_active
  ON demo_workspace_templates ((TRUE))
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS demo_company_personas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id),
  role        VARCHAR(32) NOT NULL,
  user_id     UUID NOT NULL REFERENCES users(id),
  status      VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT demo_company_personas_role_check
    CHECK (role IN ('executive', 'regional_manager', 'team_leader')),
  CONSTRAINT demo_company_personas_status_check
    CHECK (status IN ('active', 'archived'))
);

COMMENT ON TABLE demo_company_personas IS
  'Maps Executive / Regional Manager / Team Leader to exact users in a demo company. Never hard-deleted.';

CREATE UNIQUE INDEX IF NOT EXISTS demo_company_personas_one_active_role
  ON demo_company_personas (company_id, role)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_demo_company_personas_company_id
  ON demo_company_personas (company_id);
CREATE INDEX IF NOT EXISTS idx_demo_company_personas_user_id
  ON demo_company_personas (user_id);

-- ---------------------------------------------------------------------------
-- Minimal fictional master organisation (Phase 11 fixture, not Phase 12 seed)
-- Unusable password hash — public demo never uses password login.
-- ---------------------------------------------------------------------------
INSERT INTO companies (id, name, slug, seat_limit, is_platform, is_active)
VALUES (
  'd1111111-1111-4111-8111-111111111111',
  'Northstar Advisory',
  'northstar-advisory-template',
  10,
  FALSE,
  TRUE
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO company_roles (id, company_id, name, is_default, is_system)
VALUES
  ('d1111111-1111-4111-8111-111111111501', 'd1111111-1111-4111-8111-111111111111', 'Executive', FALSE, TRUE),
  ('d1111111-1111-4111-8111-111111111502', 'd1111111-1111-4111-8111-111111111111', 'Regional Manager', FALSE, TRUE),
  ('d1111111-1111-4111-8111-111111111503', 'd1111111-1111-4111-8111-111111111111', 'Team Leader', FALSE, TRUE),
  ('d1111111-1111-4111-8111-111111111504', 'd1111111-1111-4111-8111-111111111111', 'Financial Advisor', TRUE, TRUE)
ON CONFLICT (company_id, name) DO NOTHING;

INSERT INTO company_role_permissions (role_id, permission_key)
SELECT 'd1111111-1111-4111-8111-111111111501', key
FROM UNNEST(ARRAY['view_company', 'view_team', 'manage_roles', 'manage_members', 'manage_company']) AS key
ON CONFLICT DO NOTHING;

INSERT INTO company_role_permissions (role_id, permission_key)
SELECT 'd1111111-1111-4111-8111-111111111502', key
FROM UNNEST(ARRAY['view_team', 'manage_members']) AS key
ON CONFLICT DO NOTHING;

INSERT INTO company_role_permissions (role_id, permission_key)
SELECT 'd1111111-1111-4111-8111-111111111503', key
FROM UNNEST(ARRAY['view_team', 'manage_members']) AS key
ON CONFLICT DO NOTHING;

INSERT INTO users (
  id, first_name, last_name, email, phone, company, role, password_hash,
  company_id, company_role_id, reports_to_user_id, is_platform_admin,
  is_active, email_verified_at, completed_guided_tour
) VALUES
(
  'd1111111-1111-4111-8111-111111111201',
  'Alex', 'Rivera', 'alex.rivera@northstar.demo.invalid', '000 000 0001',
  'Northstar Advisory', 'Executive',
  '$2b$10$7qk.w275sP5l4htSpOtGcOI9sx8kV5NgiKpgzUhpVeSQ9.7aaBoru',
  'd1111111-1111-4111-8111-111111111111',
  'd1111111-1111-4111-8111-111111111501',
  NULL, FALSE, FALSE, NOW(), TRUE
),
(
  'd1111111-1111-4111-8111-111111111202',
  'Jordan', 'Hale', 'jordan.hale@northstar.demo.invalid', '000 000 0002',
  'Northstar Advisory', 'Regional Manager',
  '$2b$10$7qk.w275sP5l4htSpOtGcOI9sx8kV5NgiKpgzUhpVeSQ9.7aaBoru',
  'd1111111-1111-4111-8111-111111111111',
  'd1111111-1111-4111-8111-111111111502',
  'd1111111-1111-4111-8111-111111111201', FALSE, FALSE, NOW(), TRUE
),
(
  'd1111111-1111-4111-8111-111111111203',
  'Sam', 'Okonkwo', 'sam.okonkwo@northstar.demo.invalid', '000 000 0003',
  'Northstar Advisory', 'Team Leader',
  '$2b$10$7qk.w275sP5l4htSpOtGcOI9sx8kV5NgiKpgzUhpVeSQ9.7aaBoru',
  'd1111111-1111-4111-8111-111111111111',
  'd1111111-1111-4111-8111-111111111503',
  'd1111111-1111-4111-8111-111111111202', FALSE, FALSE, NOW(), TRUE
),
(
  'd1111111-1111-4111-8111-111111111204',
  'Riley', 'Chen', 'riley.chen@northstar.demo.invalid', '000 000 0004',
  'Northstar Advisory', 'Financial Advisor',
  '$2b$10$7qk.w275sP5l4htSpOtGcOI9sx8kV5NgiKpgzUhpVeSQ9.7aaBoru',
  'd1111111-1111-4111-8111-111111111111',
  'd1111111-1111-4111-8111-111111111504',
  'd1111111-1111-4111-8111-111111111203', FALSE, FALSE, NOW(), TRUE
)
ON CONFLICT (email) DO NOTHING;

INSERT INTO regions (id, company_id, name, manager_user_id, is_active)
VALUES (
  'd1111111-1111-4111-8111-111111111301',
  'd1111111-1111-4111-8111-111111111111',
  'Coastal Region',
  'd1111111-1111-4111-8111-111111111202',
  TRUE
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO teams (id, company_id, region_id, name, leader_user_id, is_active)
VALUES (
  'd1111111-1111-4111-8111-111111111401',
  'd1111111-1111-4111-8111-111111111111',
  'd1111111-1111-4111-8111-111111111301',
  'Harbour Team',
  'd1111111-1111-4111-8111-111111111203',
  TRUE
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO demo_company_personas (id, company_id, role, user_id, status)
VALUES
  ('d1111111-1111-4111-8111-111111111601', 'd1111111-1111-4111-8111-111111111111', 'executive', 'd1111111-1111-4111-8111-111111111201', 'active'),
  ('d1111111-1111-4111-8111-111111111602', 'd1111111-1111-4111-8111-111111111111', 'regional_manager', 'd1111111-1111-4111-8111-111111111202', 'active'),
  ('d1111111-1111-4111-8111-111111111603', 'd1111111-1111-4111-8111-111111111111', 'team_leader', 'd1111111-1111-4111-8111-111111111203', 'active')
ON CONFLICT DO NOTHING;

INSERT INTO demo_workspace_templates (id, company_id, status)
VALUES ('d1111111-1111-4111-8111-111111111701', 'd1111111-1111-4111-8111-111111111111', 'active')
ON CONFLICT (company_id) DO NOTHING;

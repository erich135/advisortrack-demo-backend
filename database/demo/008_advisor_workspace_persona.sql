-- Demo-only. Apply exclusively to advisortrack_demo.
-- A8.1: allow Viewing As Financial Advisor. Not a production migration.

ALTER TABLE demo_sessions
  DROP CONSTRAINT IF EXISTS demo_sessions_role_check;

ALTER TABLE demo_sessions
  ADD CONSTRAINT demo_sessions_role_check
  CHECK (
    selected_role IS NULL OR selected_role IN (
      'executive',
      'regional_manager',
      'team_leader',
      'financial_advisor'
    )
  );

ALTER TABLE demo_company_personas
  DROP CONSTRAINT IF EXISTS demo_company_personas_role_check;

ALTER TABLE demo_company_personas
  ADD CONSTRAINT demo_company_personas_role_check
  CHECK (
    role IN (
      'executive',
      'regional_manager',
      'team_leader',
      'financial_advisor'
    )
  );

COMMENT ON COLUMN demo_sessions.selected_role IS
  'Public demo persona: Executive, Regional Manager, Team Leader, or Financial Advisor.';

-- Phase 11 fixture (Riley Chen) if that template is still active.
INSERT INTO demo_company_personas (company_id, role, user_id, status)
SELECT
  'd1111111-1111-4111-8111-111111111111',
  'financial_advisor',
  'd1111111-1111-4111-8111-111111111204',
  'active'
WHERE EXISTS (
  SELECT 1 FROM users WHERE id = 'd1111111-1111-4111-8111-111111111204'
)
ON CONFLICT DO NOTHING;

-- Northstar master Maya Brooks (Phase 12 seed), if present.
INSERT INTO demo_company_personas (company_id, role, user_id, status)
SELECT u.company_id, 'financial_advisor', u.id, 'active'
FROM users u
INNER JOIN demo_workspace_templates t ON t.company_id = u.company_id AND t.status = 'active'
WHERE u.first_name = 'Maya'
  AND u.last_name = 'Brooks'
  AND COALESCE(u.is_active, TRUE) = TRUE
  AND NOT EXISTS (
    SELECT 1
    FROM demo_company_personas p
    WHERE p.company_id = u.company_id
      AND p.role = 'financial_advisor'
      AND p.status = 'active'
  );

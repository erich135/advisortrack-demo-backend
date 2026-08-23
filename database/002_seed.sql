-- =============================================================================
-- AdvisorTrack — seed demo data (development only)
-- Run AFTER 001_init.sql
-- =============================================================================

-- Demo login: john.mitchell@advisortrack.com / password
INSERT INTO contacts (
  user_id,
  first_name,
  last_name,
  id_number,
  email,
  phone,
  gender,
  income_bracket,
  status,
  priority,
  rating,
  interests,
  address,
  notes
)
SELECT
  u.id,
  'Michael',
  'Chen',
  '8001015800084',
  'michael.chen@email.com',
  '(555) 345-6789',
  'Male'::contact_gender,
  'R15000 - R50000'::income_bracket,
  'prospect',
  'medium',
  3.5,
  ARRAY['Retirement', 'Investments']::product_tag[],
  '123 Main Rd, Cape Town',
  'Prospect from referral'
FROM users u
WHERE u.email = 'john.mitchell@advisortrack.com'
  AND NOT EXISTS (
    SELECT 1 FROM contacts c WHERE c.user_id = u.id AND c.email = 'michael.chen@email.com'
  );

-- Sample activity (current week)
INSERT INTO activities (
  user_id,
  contact_id,
  pipeline_stage,
  status,
  tags,
  due_date,
  due_time,
  estimated_value,
  notes
)
SELECT
  u.id,
  c.id,
  'Interview'::pipeline_stage,
  'scheduled',
  ARRAY['Life Cover', 'Estate Planning']::product_tag[],
  CURRENT_DATE + 1,
  '10:00:00',
  15000.00,
  'First interview meeting'
FROM users u
JOIN contacts c ON c.user_id = u.id AND c.email = 'sarah.johnson@email.com'
WHERE u.email = 'john.mitchell@advisortrack.com'
  AND NOT EXISTS (
    SELECT 1 FROM activities a
    WHERE a.user_id = u.id AND a.notes = 'First interview meeting'
  );

-- Additional pipeline activities for dashboard weekly stats
INSERT INTO activities (user_id, pipeline_stage, status, due_date, notes)
SELECT u.id, 'Initial Contact'::pipeline_stage, 'completed', CURRENT_DATE, 'Dashboard seed — call'
FROM users u
WHERE u.email = 'john.mitchell@advisortrack.com'
  AND NOT EXISTS (
    SELECT 1 FROM activities a WHERE a.user_id = u.id AND a.notes = 'Dashboard seed — call'
  );

INSERT INTO activities (user_id, pipeline_stage, status, due_date, notes)
SELECT u.id, 'Analysis'::pipeline_stage, 'scheduled', CURRENT_DATE + 2, 'Dashboard seed — quote'
FROM users u
WHERE u.email = 'john.mitchell@advisortrack.com'
  AND NOT EXISTS (
    SELECT 1 FROM activities a WHERE a.user_id = u.id AND a.notes = 'Dashboard seed — quote'
  );

-- Sample production entry (current month)
INSERT INTO production_entries (
  user_id,
  contact_id,
  title,
  pipeline_stage,
  entry_type,
  tags,
  due_date,
  amount,
  product_name,
  is_issued,
  issued_at
)
SELECT
  u.id,
  c.id,
  'Life policy commission',
  'Implementation'::pipeline_stage,
  'commission',
  ARRAY['Estate Planning', 'Life Cover', 'Dread Disease']::product_tag[],
  CURRENT_DATE,
  8744.90,
  'Life Cover',
  TRUE,
  NOW()
FROM users u
JOIN contacts c ON c.user_id = u.id AND c.email = 'jennifer.homan@email.com'
WHERE u.email = 'john.mitchell@advisortrack.com'
  AND NOT EXISTS (
    SELECT 1 FROM production_entries p
    WHERE p.user_id = u.id AND p.title = 'Life policy commission'
  );

-- Financial profile goal for dashboard progress
UPDATE advisor_financial_profile afp
SET monthly_goal_nett = 50000.00
FROM users u
WHERE afp.user_id = u.id
  AND u.email = 'john.mitchell@advisortrack.com'
  AND afp.monthly_goal_nett IS NULL;

-- Monthly goal for dashboard
INSERT INTO production_monthly_goals (user_id, month, goal_amount)
SELECT u.id, DATE_TRUNC('month', CURRENT_DATE)::DATE, 50000.00
FROM users u
WHERE u.email = 'john.mitchell@advisortrack.com'
ON CONFLICT (user_id, month) DO NOTHING;

SELECT 'Seed data applied.' AS message;

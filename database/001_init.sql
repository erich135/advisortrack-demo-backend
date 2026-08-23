-- =============================================================================
-- AdvisorTrack — PostgreSQL initial schema
-- =============================================================================
-- Run this script in pgAdmin 4 (Query Tool) against your database.
--
-- Recommended setup in pgAdmin:
--   1. Create database: advisor_track
--   2. Open Query Tool → paste this file → Execute (F5)
-- =============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";     -- case-insensitive email

-- =============================================================================
-- ENUM types (match app pickers / status values)
-- =============================================================================

CREATE TYPE contact_status AS ENUM ('prospect', 'active', 'inactive');
CREATE TYPE contact_priority AS ENUM ('low', 'medium', 'high');
CREATE TYPE contact_gender AS ENUM ('Male', 'Female');

CREATE TYPE income_bracket AS ENUM (
  '< R15000',
  'R15000 - R50000',
  '> R50000'
);

-- Pipeline stage shown on Create Activity / Create Production screens
CREATE TYPE pipeline_stage AS ENUM (
  'Initial Contact',
  'Interview',
  'Analysis',
  'Recommendation',
  'Implementation',
  'Review'
);

CREATE TYPE activity_status AS ENUM ('scheduled', 'completed', 'cancelled');

CREATE TYPE production_entry_type AS ENUM (
  'commission',
  'fee',
  'bonus',
  'renewal',
  'other'
);

-- Product / interest tags (Create Contact interests, activity & production tags)
CREATE TYPE product_tag AS ENUM (
  'Estate Planning',
  'Life Cover',
  'Disability',
  'Dread Disease',
  'Retirement',
  'Savings',
  'Investments',
  'Short Term',
  'Medical Aid'
);

-- =============================================================================
-- USERS & AUTH
-- Profile Settings screen + login/register
-- =============================================================================

CREATE TABLE users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity (Profile Settings: name, surname, email, phone)
  first_name          VARCHAR(100) NOT NULL,
  last_name           VARCHAR(100) NOT NULL,
  email               CITEXT NOT NULL UNIQUE,
  phone               VARCHAR(30),
  company             VARCHAR(200),
  role                VARCHAR(100) DEFAULT 'Financial Advisor',
  avatar_url          TEXT,

  -- Auth
  password_hash       TEXT NOT NULL,

  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  email_verified_at   TIMESTAMPTZ,
  last_login_at       TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE users IS 'Advisor accounts — identity, auth, and profile (non-financial)';

-- =============================================================================
-- ADVISOR FINANCIAL PROFILE (one row per user)
-- Profile Settings — earnings targets & commission split
-- =============================================================================

CREATE TABLE advisor_financial_profile (
  user_id                 UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

  monthly_goal_nett       NUMERIC(14, 2),   -- Monthly Desired Earnings (Nett)
  monthly_deductions      NUMERIC(14, 2),   -- Monthly Deductions
  commission_split        VARCHAR(255),     -- Commission Split (If Any)

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE advisor_financial_profile IS 'Profile Settings financial fields — separate from core user identity';
COMMENT ON COLUMN advisor_financial_profile.monthly_goal_nett IS 'Monthly Desired Earnings (Nett)';
COMMENT ON COLUMN advisor_financial_profile.commission_split IS 'Contractual commission split (free text)';

-- =============================================================================
-- GENERAL SETTINGS (one row per user)
-- General Settings screen — overrides & conversion ratios
-- =============================================================================

CREATE TABLE advisor_general_settings (
  user_id                         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

  -- Average Commission per Client
  avg_commission_override         BOOLEAN NOT NULL DEFAULT FALSE,
  avg_commission_amount           NUMERIC(14, 2) DEFAULT 10000.00,

  -- Tax Directive Override
  tax_directive_override          BOOLEAN NOT NULL DEFAULT FALSE,
  tax_rate_percent                NUMERIC(5, 2) DEFAULT 23.00,

  -- Conversion Ratio's (0–10 scale, matching app sliders)
  cold_call_to_interview_override     BOOLEAN NOT NULL DEFAULT FALSE,
  cold_call_to_interview_ratio        NUMERIC(4, 2) NOT NULL DEFAULT 4.00,

  interview_to_analysis_override      BOOLEAN NOT NULL DEFAULT FALSE,
  interview_to_analysis_ratio       NUMERIC(4, 2) NOT NULL DEFAULT 6.00,

  analysis_to_recommendation_override BOOLEAN NOT NULL DEFAULT FALSE,
  analysis_to_recommendation_ratio    NUMERIC(4, 2) NOT NULL DEFAULT 6.00,

  recommendation_to_implementation_override BOOLEAN NOT NULL DEFAULT FALSE,
  recommendation_to_implementation_ratio    NUMERIC(4, 2) NOT NULL DEFAULT 6.00,

  submission_to_issued_override       BOOLEAN NOT NULL DEFAULT FALSE,
  submission_to_issued_ratio          NUMERIC(4, 2) NOT NULL DEFAULT 8.00,

  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE advisor_general_settings IS 'General Settings screen — commission/tax overrides and pipeline conversion ratios';

-- Auto-create general settings + financial profile when a user registers
CREATE OR REPLACE FUNCTION create_default_advisor_settings()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO advisor_general_settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO advisor_financial_profile (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_create_advisor_settings
  AFTER INSERT ON users
  FOR EACH ROW
  EXECUTE PROCEDURE create_default_advisor_settings();

-- Optional: password reset tokens (forgot-password flow)
CREATE TABLE password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_password_reset_tokens_user ON password_reset_tokens(user_id);

-- =============================================================================
-- CONTACTS
-- Create Contact screen + Contacts list
-- =============================================================================

CREATE TABLE contacts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Create Contact form
  first_name          VARCHAR(100) NOT NULL,
  last_name           VARCHAR(100) NOT NULL DEFAULT '',
  full_name           VARCHAR(200) GENERATED ALWAYS AS (
                        TRIM(BOTH FROM first_name || ' ' || last_name)
                      ) STORED,
  id_number           VARCHAR(50),
  email               CITEXT,
  phone               VARCHAR(30),
  company             VARCHAR(200),
  avatar_url          TEXT,

  -- Address / location (Set address Location)
  address             TEXT,
  latitude            DOUBLE PRECISION,
  longitude           DOUBLE PRECISION,

  gender              contact_gender,
  income_bracket      income_bracket,

  -- Client Rating (star rating) + list filters
  status              contact_status NOT NULL DEFAULT 'prospect',
  priority            contact_priority NOT NULL DEFAULT 'medium',
  rating              NUMERIC(2, 1) NOT NULL DEFAULT 3.0
                        CHECK (rating >= 0 AND rating <= 5),

  -- Interests — multi-select product tags
  interests           product_tag[] NOT NULL DEFAULT '{}',

  notes               TEXT,
  last_contacted_at   TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT contacts_rating_step CHECK (rating * 2 = FLOOR(rating * 2))
);

CREATE INDEX idx_contacts_user_id ON contacts(user_id);
CREATE INDEX idx_contacts_user_status ON contacts(user_id, status);
CREATE INDEX idx_contacts_user_name ON contacts(user_id, last_name, first_name);
CREATE INDEX idx_contacts_email ON contacts(email);

COMMENT ON TABLE contacts IS 'Clients/prospects — Create Contact form and Contacts tab';
COMMENT ON COLUMN contacts.interests IS 'Interests chip multi-select from Create Contact';

-- =============================================================================
-- ACTIVITIES
-- Create/Edit Activity screen + Activities feed
-- =============================================================================

CREATE TABLE activities (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id          UUID REFERENCES contacts(id) ON DELETE SET NULL,

  -- Create Activity form
  title               VARCHAR(255),          -- optional; can be auto-generated
  pipeline_stage      pipeline_stage,        -- Activity Type dropdown
  status              activity_status NOT NULL DEFAULT 'scheduled',

  tags                product_tag[] NOT NULL DEFAULT '{}',

  due_date            DATE,
  due_time            TIME,
  due_at              TIMESTAMPTZ,

  estimated_value     NUMERIC(14, 2),
  notes               VARCHAR(500),

  -- Legacy / API compatibility (call, meeting, email, etc.)
  legacy_type         VARCHAR(50),

  duration_minutes    INTEGER CHECK (duration_minutes IS NULL OR duration_minutes > 0),

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_activities_user_id ON activities(user_id);
CREATE INDEX idx_activities_user_due ON activities(user_id, due_at);
CREATE INDEX idx_activities_contact ON activities(contact_id);

COMMENT ON TABLE activities IS 'Create/Edit Activity — pipeline tasks linked to contacts';
COMMENT ON COLUMN activities.pipeline_stage IS 'Activity Type: Initial Contact, Interview, Analysis, etc.';

-- =============================================================================
-- PRODUCTION ENTRIES
-- Create/Edit Production screen + Production tab
-- =============================================================================

CREATE TABLE production_entries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id          UUID REFERENCES contacts(id) ON DELETE SET NULL,

  title               VARCHAR(255) NOT NULL,
  pipeline_stage      pipeline_stage,
  entry_type          production_entry_type NOT NULL DEFAULT 'commission',

  tags                product_tag[] NOT NULL DEFAULT '{}',

  due_date            DATE,
  amount              NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  product_name        VARCHAR(200),
  notes               VARCHAR(500),

  -- Issued checkbox on Create Production
  is_issued           BOOLEAN NOT NULL DEFAULT FALSE,
  issued_at           TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_production_user_id ON production_entries(user_id);
CREATE INDEX idx_production_user_date ON production_entries(user_id, due_date);
CREATE INDEX idx_production_contact ON production_entries(contact_id);
CREATE INDEX idx_production_issued ON production_entries(user_id, is_issued);

COMMENT ON TABLE production_entries IS 'Create/Edit Production — issued cases and commission amounts';

-- =============================================================================
-- MONTHLY PRODUCTION GOALS (dashboard gauges)
-- =============================================================================

CREATE TABLE production_monthly_goals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month       DATE NOT NULL,                 -- first day of month, e.g. 2025-06-01
  goal_amount NUMERIC(14, 2) NOT NULL DEFAULT 50000.00,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, month)
);

-- =============================================================================
-- updated_at trigger (all main tables)
-- =============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER trg_general_settings_updated_at
  BEFORE UPDATE ON advisor_general_settings FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER trg_financial_profile_updated_at
  BEFORE UPDATE ON advisor_financial_profile FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER trg_contacts_updated_at
  BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER trg_activities_updated_at
  BEFORE UPDATE ON activities FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER trg_production_updated_at
  BEFORE UPDATE ON production_entries FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER trg_production_goals_updated_at
  BEFORE UPDATE ON production_monthly_goals FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- =============================================================================
-- HELPFUL VIEWS
-- =============================================================================

-- Dashboard production summary (current month)
CREATE OR REPLACE VIEW v_production_summary AS
SELECT
  pe.user_id,
  DATE_TRUNC('month', COALESCE(pe.due_date, pe.created_at::DATE))::DATE AS month,
  SUM(pe.amount) AS total,
  COALESCE(g.goal_amount, 50000.00) AS goal,
  SUM(pe.amount) FILTER (WHERE pe.entry_type = 'commission') AS commission_total,
  SUM(pe.amount) FILTER (WHERE pe.entry_type = 'fee') AS fee_total,
  SUM(pe.amount) FILTER (WHERE pe.entry_type = 'bonus') AS bonus_total,
  SUM(pe.amount) FILTER (WHERE pe.entry_type = 'renewal') AS renewal_total,
  SUM(pe.amount) FILTER (WHERE pe.entry_type = 'other') AS other_total
FROM production_entries pe
LEFT JOIN production_monthly_goals g
  ON g.user_id = pe.user_id
 AND g.month = DATE_TRUNC('month', COALESCE(pe.due_date, pe.created_at::DATE))::DATE
GROUP BY pe.user_id, DATE_TRUNC('month', COALESCE(pe.due_date, pe.created_at::DATE))::DATE, g.goal_amount;

-- =============================================================================
-- SEED: demo advisor (password = "password" — bcrypt hash below)
-- Run only in development. Change password before production.
-- =============================================================================

-- bcrypt hash for the word "password" (10 rounds)
-- Generate new hashes from the Node backend: bcrypt.hash('password', 10)

INSERT INTO users (
  id,
  first_name,
  last_name,
  email,
  phone,
  company,
  role,
  password_hash
) VALUES (
  'a1111111-1111-1111-1111-111111111111',
  'John',
  'Mitchell',
  'john.mitchell@advisortrack.com',
  '(555) 123-4567',
  'Mitchell Financial Group',
  'Financial Advisor',
  '$2b$10$hFGceIanhY4H/HvLSJIp1eljgbOFspqtfKfAj79elWKl66fsePSOu'
) ON CONFLICT (email) DO NOTHING;

INSERT INTO contacts (
  user_id, first_name, last_name, email, phone, company,
  status, priority, rating, last_contacted_at
)
SELECT
  u.id,
  'Sarah', 'Johnson', 'sarah.johnson@email.com', '(555) 234-5678', 'Johnson & Associates',
  'active'::contact_status, 'high'::contact_priority, 4.5, '2025-06-10 14:00:00+00'
FROM users u
WHERE u.email = 'john.mitchell@advisortrack.com'
  AND NOT EXISTS (
    SELECT 1 FROM contacts c WHERE c.user_id = u.id AND c.email = 'sarah.johnson@email.com'
  );

INSERT INTO contacts (
  user_id, first_name, last_name, email, phone,
  status, priority, rating, last_contacted_at
)
SELECT
  u.id,
  'Jennifer', 'Homan', 'jennifer.homan@email.com', '(555) 789-0123',
  'active'::contact_status, 'high'::contact_priority, 4.0, '2025-06-14 10:00:00+00'
FROM users u
WHERE u.email = 'john.mitchell@advisortrack.com'
  AND NOT EXISTS (
    SELECT 1 FROM contacts c WHERE c.user_id = u.id AND c.email = 'jennifer.homan@email.com'
  );

-- Demo login: john.mitchell@advisortrack.com / password

-- =============================================================================
-- Done
-- =============================================================================
SELECT 'AdvisorTrack schema created successfully.' AS message;

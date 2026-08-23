-- Migration 010: Sandbox / Live Preview tiers, contact activation, billing prep
-- Run after 009_client_cases.sql

-- Contact practice vs real, active vs archived (downgrade read-only)
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS is_practice BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS activation_status VARCHAR(16) NOT NULL DEFAULT 'active';

ALTER TABLE contacts
  DROP CONSTRAINT IF EXISTS contacts_activation_status_check;

ALTER TABLE contacts
  ADD CONSTRAINT contacts_activation_status_check
  CHECK (activation_status IN ('active', 'archived'));

COMMENT ON COLUMN contacts.is_practice IS 'TRUE for sandbox practice clients — never counts toward Live Preview limits';
COMMENT ON COLUMN contacts.activation_status IS 'active = editable; archived = read-only after Pro downgrade';

CREATE INDEX IF NOT EXISTS idx_contacts_user_activation
  ON contacts(user_id, is_practice, activation_status);

-- Onboarding + billing fields on user subscription
ALTER TABLE user_subscriptions
  ADD COLUMN IF NOT EXISTS live_preview_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS live_preview_enabled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sandbox_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS grace_period_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revenuecat_app_user_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS billing_store VARCHAR(16);

COMMENT ON COLUMN user_subscriptions.live_preview_enabled IS 'Free tier opt-in — up to 3 active real contacts';
COMMENT ON COLUMN user_subscriptions.sandbox_completed_at IS 'Set when user finishes or skips the practice onboarding tour';
COMMENT ON COLUMN user_subscriptions.grace_period_ends_at IS 'Pro access continues until this timestamp after payment lapse';
COMMENT ON COLUMN user_subscriptions.revenuecat_app_user_id IS 'RevenueCat customer id — wired when store billing is enabled';
COMMENT ON COLUMN user_subscriptions.billing_store IS 'app_store | play_store | stub';

-- Remove time-limited Pro trial from sellable packages (sandbox + Live Preview replace trial)
UPDATE subscription_packages
SET trial_days = 0,
    description = CASE slug
      WHEN 'free' THEN 'Practice clients and optional Live Preview (up to 3 real clients). Upgrade for unlimited clients and full analytics.'
      WHEN 'pro' THEN 'Unlimited clients, weekly points, pipeline conversion, and adaptive planning tools.'
      WHEN 'premium' THEN 'Everything in Pro plus priority support and advanced reporting (coming soon).'
      ELSE description
    END
WHERE slug IN ('free', 'pro', 'premium');

-- Live Preview base features on free tier (not Pro analytics)
INSERT INTO package_features (package_id, feature_key)
SELECT p.id, f.feature_key
FROM subscription_packages p
CROSS JOIN (VALUES
  ('live_preview'),
  ('pipeline_case'),
  ('basic_income')
) AS f(feature_key)
WHERE p.slug = 'free'
ON CONFLICT DO NOTHING;

-- Pro bulk import
INSERT INTO package_features (package_id, feature_key)
SELECT p.id, 'bulk_import'
FROM subscription_packages p
WHERE p.slug IN ('pro', 'premium')
ON CONFLICT DO NOTHING;

-- Migrate users still on legacy Pro trial to free Starter
UPDATE user_subscriptions us
SET
  package_id = (SELECT id FROM subscription_packages WHERE slug = 'free' LIMIT 1),
  status = 'active',
  trial_ends_at = NULL,
  current_period_end = NULL,
  updated_at = NOW()
WHERE us.status = 'trialing';

-- Migration 008: Subscription packages, feature flags, and user entitlements
-- Run after 007_activity_pipeline_outcomes.sql

CREATE TABLE IF NOT EXISTS subscription_packages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            VARCHAR(64) NOT NULL UNIQUE,
  name            VARCHAR(128) NOT NULL,
  tagline         VARCHAR(255),
  description     TEXT,
  price_cents     INT NOT NULL DEFAULT 0,
  currency        CHAR(3) NOT NULL DEFAULT 'ZAR',
  billing_interval VARCHAR(16),
  trial_days      INT NOT NULL DEFAULT 0,
  sort_order      INT NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  is_highlighted  BOOLEAN NOT NULL DEFAULT FALSE,
  badge_label     VARCHAR(64),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE subscription_packages IS 'Sellable plans — add rows here to expose new packages in the app';
COMMENT ON COLUMN subscription_packages.slug IS 'Stable key used in code and APIs (e.g. free, pro)';
COMMENT ON COLUMN subscription_packages.billing_interval IS 'NULL for free tier; month or year for paid plans';

CREATE TABLE IF NOT EXISTS package_features (
  package_id   UUID NOT NULL REFERENCES subscription_packages(id) ON DELETE CASCADE,
  feature_key  VARCHAR(64) NOT NULL,
  PRIMARY KEY (package_id, feature_key)
);

COMMENT ON TABLE package_features IS 'Maps packages to feature keys — add feature_key rows to unlock capabilities';

CREATE TABLE IF NOT EXISTS user_subscriptions (
  user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  package_id           UUID NOT NULL REFERENCES subscription_packages(id),
  status               VARCHAR(32) NOT NULL DEFAULT 'active',
  trial_ends_at        TIMESTAMPTZ,
  current_period_end   TIMESTAMPTZ,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE user_subscriptions IS 'Current plan per advisor — one active row per user';
COMMENT ON COLUMN user_subscriptions.status IS 'active | trialing | expired | cancelled';

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_package ON user_subscriptions(package_id);

DROP TRIGGER IF EXISTS trg_subscription_packages_updated_at ON subscription_packages;
CREATE TRIGGER trg_subscription_packages_updated_at
  BEFORE UPDATE ON subscription_packages
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

DROP TRIGGER IF EXISTS trg_user_subscriptions_updated_at ON user_subscriptions;
CREATE TRIGGER trg_user_subscriptions_updated_at
  BEFORE UPDATE ON user_subscriptions
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- Seed packages (idempotent via slug)
INSERT INTO subscription_packages (slug, name, tagline, description, price_cents, billing_interval, trial_days, sort_order, is_highlighted, badge_label)
VALUES
  (
    'free',
    'Starter',
    'Essential tracking',
    'Income summary and basic activity logging. Upgrade to unlock points, pipeline insights, and planning tools.',
    0,
    NULL,
    0,
    1,
    FALSE,
    NULL
  ),
  (
    'pro',
    'Pro Advisor',
    'Full performance toolkit',
    'Weekly points, pipeline conversion, upcoming events, and adaptive planning ratios.',
    34900,
    'month',
    14,
    2,
    TRUE,
    'Most popular'
  ),
  (
    'premium',
    'Premium',
    'For high-volume teams',
    'Everything in Pro plus priority support and advanced reporting (coming soon).',
    59900,
    'month',
    14,
    3,
    FALSE,
    'Best value'
  )
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  tagline = EXCLUDED.tagline,
  description = EXCLUDED.description,
  price_cents = EXCLUDED.price_cents,
  billing_interval = EXCLUDED.billing_interval,
  trial_days = EXCLUDED.trial_days,
  sort_order = EXCLUDED.sort_order,
  is_highlighted = EXCLUDED.is_highlighted,
  badge_label = EXCLUDED.badge_label,
  updated_at = NOW();

-- Feature keys (see src/features/subscriptionFeatures.ts for definitions)
INSERT INTO package_features (package_id, feature_key)
SELECT p.id, f.feature_key
FROM subscription_packages p
CROSS JOIN (VALUES
  ('weekly_points'),
  ('pipeline_analytics'),
  ('upcoming_events'),
  ('adaptive_ratios')
) AS f(feature_key)
WHERE p.slug IN ('pro', 'premium')
ON CONFLICT DO NOTHING;

SELECT 'Migration 008: subscriptions applied.' AS message;

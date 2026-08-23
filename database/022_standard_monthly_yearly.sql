-- 022: Advisor Standard only — monthly R349 + yearly, 7-day app trial; hide Premium from sale.

UPDATE subscription_packages
SET
  price_cents = 34900,
  trial_days = 7,
  billing_interval = 'month',
  updated_at = NOW()
WHERE slug = 'pro';

INSERT INTO subscription_packages (
  slug,
  name,
  tagline,
  description,
  price_cents,
  currency,
  billing_interval,
  trial_days,
  sort_order,
  is_active,
  is_highlighted,
  badge_label
)
VALUES (
  'pro_yearly',
  'Advisor Standard',
  'Annual billing',
  'Unlimited clients, weekly points, pipeline conversion, and planning tools — billed once per year.',
  349000,
  'ZAR',
  'year',
  7,
  3,
  TRUE,
  FALSE,
  'Save 2 months'
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  tagline = EXCLUDED.tagline,
  description = EXCLUDED.description,
  price_cents = EXCLUDED.price_cents,
  billing_interval = EXCLUDED.billing_interval,
  trial_days = EXCLUDED.trial_days,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  is_highlighted = EXCLUDED.is_highlighted,
  badge_label = EXCLUDED.badge_label,
  updated_at = NOW();

-- Same Standard feature set as monthly
INSERT INTO package_features (package_id, feature_key)
SELECT py.id, pf.feature_key
FROM subscription_packages py
CROSS JOIN subscription_packages pm
JOIN package_features pf ON pf.package_id = pm.id
WHERE py.slug = 'pro_yearly'
  AND pm.slug = 'pro'
ON CONFLICT DO NOTHING;

-- Premium stays in DB for future but is not sellable in v1
UPDATE subscription_packages
SET
  is_active = FALSE,
  badge_label = 'Coming Soon',
  updated_at = NOW()
WHERE slug = 'premium';

COMMENT ON TABLE subscription_packages IS 'Sellable plans — v1: Starter (free), Advisor Standard monthly/yearly only';

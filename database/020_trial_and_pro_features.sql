-- 020: 7-day Standard trial + Advisor Pro feature differentiation
UPDATE subscription_packages
SET trial_days = 7, updated_at = NOW()
WHERE slug = 'pro';

-- Pro-only features (not on Advisor Standard)
INSERT INTO package_features (package_id, feature_key)
SELECT p.id, f.feature_key
FROM subscription_packages p
CROSS JOIN (
  VALUES
    ('priority_support'),
    ('advanced_reporting')
) AS f(feature_key)
WHERE p.slug = 'premium'
ON CONFLICT DO NOTHING;

-- 024: Standard trial length 7 → 14 days (align with Play / App Store intro offer).
UPDATE subscription_packages
SET trial_days = 14, updated_at = NOW()
WHERE slug IN ('pro', 'pro_yearly');

-- Sprint 5 commercial package labels (P8-07, P8-08, P8-09)
UPDATE subscription_packages
SET
  name = 'Advisor Standard',
  tagline = 'Full performance toolkit',
  description = 'Unlimited clients, weekly points, pipeline conversion, and planning tools.',
  is_highlighted = TRUE,
  badge_label = NULL,
  updated_at = NOW()
WHERE slug = 'pro';

UPDATE subscription_packages
SET
  name = 'Advisor Pro',
  tagline = 'Advanced advisor suite',
  description = 'Everything in Standard plus priority support and advanced reporting.',
  price_cents = 54900,
  is_highlighted = FALSE,
  badge_label = 'Coming Soon',
  updated_at = NOW()
WHERE slug = 'premium';

-- Demo-only. Apply exclusively to advisortrack_demo.
-- Extends relative date-plan buckets/entity types for mobile activity,
-- stalled cases, upcoming next actions, and case documents.
-- Does not alter 001–003 files. Shared users.last_mobile_activity_at lives in 029.

ALTER TABLE demo_seed_date_plan
  DROP CONSTRAINT IF EXISTS demo_seed_date_plan_bucket_check;

ALTER TABLE demo_seed_date_plan
  ADD CONSTRAINT demo_seed_date_plan_bucket_check
  CHECK (bucket IN (
    'last_week',
    'last_month',
    'year_to_date',
    'current_month',
    'older',
    'hours_ago',
    'yesterday',
    'days_ago_3',
    'days_ago_4',
    'days_ago_5',
    'stale_7',
    'stale_14',
    'upcoming'
  ));

ALTER TABLE demo_seed_date_plan
  DROP CONSTRAINT IF EXISTS demo_seed_date_plan_entity_check;

ALTER TABLE demo_seed_date_plan
  ADD CONSTRAINT demo_seed_date_plan_entity_check
  CHECK (entity_type IN (
    'production',
    'activity',
    'contact',
    'case',
    'goal',
    'user_mobile',
    'case_document'
  ));

COMMENT ON TABLE demo_seed_date_plan IS
  'Relative date buckets for template rows. Applied at visitor clone time so Last Week / Last Month / YTD / mobile activity / stalled ages stay current.';

-- Demo-only. Apply exclusively to advisortrack_demo.
-- Phase 12: outbox, date-plan, template versioning. Never hard-delete.

ALTER TABLE demo_workspace_templates
  ADD COLUMN IF NOT EXISTS seed_version INT NOT NULL DEFAULT 11,
  ADD COLUMN IF NOT EXISTS version_label VARCHAR(64) NOT NULL DEFAULT 'phase11';

COMMENT ON COLUMN demo_workspace_templates.seed_version IS
  'Template generation. Phase 11 = 11, Phase 12 Northstar master = 12. Archived rows are retained.';

CREATE TABLE IF NOT EXISTS demo_seed_date_plan (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_company_id  UUID NOT NULL REFERENCES companies(id),
  entity_type          VARCHAR(32) NOT NULL,
  template_row_id      UUID NOT NULL,
  bucket               VARCHAR(32) NOT NULL,
  slot                 INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT demo_seed_date_plan_bucket_check
    CHECK (bucket IN ('last_week', 'last_month', 'year_to_date', 'current_month', 'older')),
  CONSTRAINT demo_seed_date_plan_entity_check
    CHECK (entity_type IN ('production', 'activity', 'contact', 'case', 'goal'))
);

CREATE UNIQUE INDEX IF NOT EXISTS demo_seed_date_plan_row_unique
  ON demo_seed_date_plan (entity_type, template_row_id);

CREATE INDEX IF NOT EXISTS idx_demo_seed_date_plan_company
  ON demo_seed_date_plan (template_company_id);

COMMENT ON TABLE demo_seed_date_plan IS
  'Relative date buckets for template rows. Applied at visitor clone time so Last Week / Last Month / YTD stay current.';

CREATE TABLE IF NOT EXISTS demo_outbox_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID REFERENCES companies(id),
  session_id     UUID REFERENCES demo_sessions(id),
  actor_user_id  UUID REFERENCES users(id),
  action         VARCHAR(64) NOT NULL,
  recipient      VARCHAR(320),
  payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
  status         VARCHAR(32) NOT NULL DEFAULT 'simulated',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT demo_outbox_events_status_check
    CHECK (status IN ('simulated'))
);

CREATE INDEX IF NOT EXISTS idx_demo_outbox_events_company_created
  ON demo_outbox_events (company_id, created_at DESC);

COMMENT ON TABLE demo_outbox_events IS
  'Append-only simulated external actions for the public demo. Never sends email, SMS, webhooks, or payments.';

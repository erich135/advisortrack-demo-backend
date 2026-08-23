-- =============================================================================
-- AdvisorTrack — activity pipeline outcomes + activity→case linkage
-- Run AFTER 006_adaptive_ratios.sql
-- =============================================================================

CREATE TYPE activity_outcome AS ENUM ('proceeded', 'lost', 'completed');

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS outcome activity_outcome,
  ADD COLUMN IF NOT EXISTS lost_reason VARCHAR(500),
  ADD COLUMN IF NOT EXISTS source_activity_id UUID REFERENCES activities(id) ON DELETE SET NULL;

ALTER TABLE production_entries
  ADD COLUMN IF NOT EXISTS source_activity_id UUID REFERENCES activities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_activities_user_outcome
  ON activities(user_id, outcome)
  WHERE outcome IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_production_source_activity
  ON production_entries(source_activity_id)
  WHERE source_activity_id IS NOT NULL;

COMMENT ON COLUMN activities.outcome IS 'Pipeline result: proceeded (next stage), lost (dead end), completed (done without advancing)';
COMMENT ON COLUMN activities.source_activity_id IS 'Prior activity when this row was spawned by Proceed';
COMMENT ON COLUMN production_entries.source_activity_id IS 'Activity that triggered case / production creation';

SELECT 'Activity pipeline outcomes migration applied.' AS message;

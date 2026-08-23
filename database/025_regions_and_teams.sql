-- 025: Organisation regions and teams.
-- Structure entities only. users.reports_to_user_id remains the reporting line.

CREATE TABLE IF NOT EXISTS regions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name             VARCHAR(200) NOT NULL,
  manager_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT regions_id_company_id_key UNIQUE (id, company_id),
  CONSTRAINT regions_company_id_name_key UNIQUE (company_id, name)
);

COMMENT ON TABLE regions IS 'Customer-organisation regions. Archive with is_active; do not hard-delete.';
COMMENT ON COLUMN regions.manager_user_id IS 'Assigned Regional Manager. One active region per manager.';

CREATE UNIQUE INDEX IF NOT EXISTS regions_one_active_manager
  ON regions (manager_user_id)
  WHERE is_active = TRUE AND manager_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_regions_company_id ON regions (company_id);
CREATE INDEX IF NOT EXISTS idx_regions_manager_user_id ON regions (manager_user_id);

CREATE TABLE IF NOT EXISTS teams (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  region_id        UUID NOT NULL,
  name             VARCHAR(200) NOT NULL,
  leader_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT teams_region_company_fkey
    FOREIGN KEY (region_id, company_id) REFERENCES regions (id, company_id) ON DELETE CASCADE,
  CONSTRAINT teams_region_id_name_key UNIQUE (region_id, name)
);

COMMENT ON TABLE teams IS 'Customer-organisation teams. Belong to one region in the same company. Archive with is_active; do not hard-delete.';
COMMENT ON COLUMN teams.leader_user_id IS 'Assigned Team Leader. One active team per leader.';

CREATE UNIQUE INDEX IF NOT EXISTS teams_one_active_leader
  ON teams (leader_user_id)
  WHERE is_active = TRUE AND leader_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_teams_company_id ON teams (company_id);
CREATE INDEX IF NOT EXISTS idx_teams_region_id ON teams (region_id);
CREATE INDEX IF NOT EXISTS idx_teams_leader_user_id ON teams (leader_user_id);

DROP TRIGGER IF EXISTS trg_regions_updated_at ON regions;
CREATE TRIGGER trg_regions_updated_at
  BEFORE UPDATE ON regions
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

DROP TRIGGER IF EXISTS trg_teams_updated_at ON teams;
CREATE TRIGGER trg_teams_updated_at
  BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

SELECT 'Migration 025: regions and teams applied.' AS message;

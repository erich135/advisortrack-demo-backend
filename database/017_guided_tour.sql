-- Guided tour completion persisted on the user profile (P3-11)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS completed_guided_tour BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN users.completed_guided_tour IS 'True after the advisor finishes or skips the interactive guided tour';

-- 029: Last authenticated Android resource activity for Management Portal.
-- Additive nullable column only. Does not rename, drop, or change last_login_at
-- or any other existing users column type/nullability/default.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_mobile_activity_at TIMESTAMPTZ;

COMMENT ON COLUMN users.last_mobile_activity_at IS
  'Last throttled authenticated Android-app resource request. NULL means none recorded. Distinct from last_login_at.';

SELECT 'Migration 029: last_mobile_activity_at applied.' AS message;

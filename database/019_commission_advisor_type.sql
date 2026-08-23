-- Advisor commission arrangement — employed vs independent/franchise (Johan meeting 2026-07-28)
ALTER TABLE advisor_financial_profile
  ADD COLUMN IF NOT EXISTS commission_advisor_type VARCHAR(32);

COMMENT ON COLUMN advisor_financial_profile.commission_advisor_type IS
  'employee | independent — how the advisor earns commission (house employee vs franchise owner)';

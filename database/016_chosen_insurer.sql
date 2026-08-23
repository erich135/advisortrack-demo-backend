-- Chosen product provider / insurer on recommendation step (P5-05)
ALTER TABLE client_cases
  ADD COLUMN IF NOT EXISTS chosen_insurer VARCHAR(64);

COMMENT ON COLUMN client_cases.chosen_insurer IS 'Insurer or product provider selected at recommendation step';

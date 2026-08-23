-- 028: Invoice delivery metadata for Phase 8.
-- Additive columns on the Phase 7 invoice_delivery_events table only.
-- Does not alter Android-dependent companies, users, or subscription structures.

ALTER TABLE invoice_delivery_events
  ADD COLUMN IF NOT EXISTS provider_message_id VARCHAR(128);

ALTER TABLE invoice_delivery_events
  ADD COLUMN IF NOT EXISTS snapshot_ref VARCHAR(128);

COMMENT ON COLUMN invoice_delivery_events.provider_message_id IS
  'Mailtrap (or other provider) message id from a successful send submission.';
COMMENT ON COLUMN invoice_delivery_events.snapshot_ref IS
  'Identifier of the invoice snapshot that was attached (invoice number + updated_at).';

SELECT 'Migration 028: invoice delivery metadata applied.' AS message;

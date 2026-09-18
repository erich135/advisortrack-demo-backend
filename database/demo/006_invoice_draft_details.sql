-- DEMO ONLY. Isolated advisortrack_demo. Never production.
-- Task 12: optional draft invoice commercial details + discount lines.

ALTER TABLE invoice_line_items DROP CONSTRAINT IF EXISTS invoice_line_items_price_check;

CREATE TABLE IF NOT EXISTS invoice_commercial_details (
  invoice_id             UUID PRIMARY KEY REFERENCES invoices(id) ON DELETE RESTRICT,
  billing_period_start   DATE,
  billing_period_end     DATE,
  customer_reference     VARCHAR(64),
  source_contract_id     UUID,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Mirror of 027 — applied on pricelab_db (amz_transactions is shared with AmzSellMetrics).
-- Run with: psql -d pricelab_db -f 028_amz_transactions_status.sql

ALTER TABLE amz_transactions
  ADD COLUMN IF NOT EXISTS transaction_status TEXT,
  ADD COLUMN IF NOT EXISTS maturity_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deferral_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_amz_transactions_status
  ON amz_transactions (transaction_status, date_only);

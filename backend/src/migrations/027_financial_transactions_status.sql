-- Add transaction_status and maturity_date to support Finances API v2024-06-19
-- (DEFERRED / RELEASED / DEFERRED_RELEASED + DD+7 release date)
--
-- Run on BOTH databridge_db AND pricelab_db (same shape, two tables).

-- databridge_db.financial_transactions
ALTER TABLE financial_transactions
  ADD COLUMN IF NOT EXISTS transaction_status TEXT,
  ADD COLUMN IF NOT EXISTS maturity_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deferral_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_financial_transactions_status
  ON financial_transactions (transaction_status, date_only);

-- pricelab_db.amz_transactions (run separately on pricelab_db)
-- ALTER TABLE amz_transactions
--   ADD COLUMN IF NOT EXISTS transaction_status TEXT,
--   ADD COLUMN IF NOT EXISTS maturity_date TIMESTAMPTZ,
--   ADD COLUMN IF NOT EXISTS deferral_reason TEXT;
--
-- CREATE INDEX IF NOT EXISTS idx_amz_transactions_status
--   ON amz_transactions (transaction_status, date_only);

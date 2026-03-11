-- Financial transactions from SP-API (AmzSellMetrics compatible schema)
CREATE TABLE IF NOT EXISTS financial_transactions (
  transaction_id VARCHAR(255) PRIMARY KEY,
  file_name TEXT,
  transaction_date TIMESTAMPTZ,
  date_only DATE,
  type TEXT,
  category_type TEXT,
  order_id TEXT,
  sku TEXT,
  description TEXT,
  marketplace TEXT,
  marketplace_code VARCHAR(5),
  fulfillment TEXT,
  order_postal TEXT,
  quantity INTEGER DEFAULT 0,
  product_sales NUMERIC(12,2) DEFAULT 0,
  promotional_rebates NUMERIC(12,2) DEFAULT 0,
  selling_fees NUMERIC(12,2) DEFAULT 0,
  fba_fees NUMERIC(12,2) DEFAULT 0,
  other_transaction_fees NUMERIC(12,2) DEFAULT 0,
  other NUMERIC(12,2) DEFAULT 0,
  vat NUMERIC(12,2) DEFAULT 0,
  liquidations NUMERIC(12,2) DEFAULT 0,
  total NUMERIC(12,2) DEFAULT 0,
  credential_id INTEGER REFERENCES sp_api_credentials(id),
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ft_marketplace_date ON financial_transactions(marketplace_code, date_only);
CREATE INDEX IF NOT EXISTS idx_ft_category ON financial_transactions(category_type);
CREATE INDEX IF NOT EXISTS idx_ft_order_id ON financial_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_ft_sku ON financial_transactions(sku);

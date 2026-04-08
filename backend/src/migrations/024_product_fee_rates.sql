-- Product fee rates: name-bazlı fee oranları (AmzSellMetrics hesaplama mantığı, L180)
-- Kaynak: amz_transactions + sku_master join
-- Kullanım: AdPilot ASIN Profiler P&L
CREATE TABLE IF NOT EXISTS product_fee_rates (
  id              SERIAL PRIMARY KEY,
  product_name    TEXT NOT NULL,
  marketplace_code TEXT NOT NULL DEFAULT 'US',
  fulfillment     TEXT,                    -- FBA/FBM/Mixed
  sku_count       INT DEFAULT 0,
  order_count     INT DEFAULT 0,
  revenue         NUMERIC(12,2) DEFAULT 0,
  selling_fee_pct NUMERIC(6,2),            -- selling_fees / revenue * 100
  fba_fee_pct     NUMERIC(6,2),            -- fba_fees / fba_revenue * 100
  refund_loss_pct NUMERIC(6,2),            -- refund_total / revenue * 100
  fba_cost_pct    NUMERIC(6,2),            -- global: FBA overhead / fba_revenue * 100
  other_fee_pct   NUMERIC(6,2),            -- other_transaction_fees / revenue * 100
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  calculated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (product_name, marketplace_code)
);

CREATE INDEX idx_product_fee_rates_name ON product_fee_rates (product_name);

INSERT INTO schema_migrations (app_name, version, description, applied_at)
VALUES ('databridge', '024', 'product_fee_rates', NOW())
ON CONFLICT DO NOTHING;

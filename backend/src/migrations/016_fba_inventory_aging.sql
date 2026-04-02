-- 016_fba_inventory_aging.sql
-- FBA inventory aging data from GET_FBA_INVENTORY_AGED_DATA report

CREATE TABLE IF NOT EXISTS fba_inventory_aging (
  id SERIAL PRIMARY KEY,
  warehouse VARCHAR(10) NOT NULL,
  marketplace_id VARCHAR(20) NOT NULL,
  snapshot_date DATE,
  sku VARCHAR(100) NOT NULL,
  fnsku VARCHAR(20),
  asin VARCHAR(20),
  iwasku VARCHAR(50),
  product_name VARCHAR(500),
  condition VARCHAR(20),
  available_quantity INTEGER DEFAULT 0,
  qty_with_removals_in_progress INTEGER DEFAULT 0,
  inv_age_0_to_90_days INTEGER DEFAULT 0,
  inv_age_91_to_180_days INTEGER DEFAULT 0,
  inv_age_181_to_270_days INTEGER DEFAULT 0,
  inv_age_271_to_365_days INTEGER DEFAULT 0,
  inv_age_365_plus_days INTEGER DEFAULT 0,
  currency VARCHAR(5),
  estimated_ltsf_next_charge DECIMAL(12,2) DEFAULT 0,
  per_unit_volume DECIMAL(10,4),
  is_hazmat BOOLEAN DEFAULT false,
  in_date DATE,
  units_shipped_last_7_days INTEGER DEFAULT 0,
  units_shipped_last_30_days INTEGER DEFAULT 0,
  units_shipped_last_60_days INTEGER DEFAULT 0,
  units_shipped_last_90_days INTEGER DEFAULT 0,
  recommended_removal_quantity INTEGER DEFAULT 0,
  estimated_ltsf_6_mo DECIMAL(12,2) DEFAULT 0,
  estimated_ltsf_12_mo DECIMAL(12,2) DEFAULT 0,
  alert VARCHAR(50),
  your_price DECIMAL(12,2),
  sales_price DECIMAL(12,2),
  sell_through DECIMAL(10,4),
  storage_type VARCHAR(20),
  recommended_action VARCHAR(100),
  estimated_cost_savings DECIMAL(12,2) DEFAULT 0,
  healthy_inventory_level INTEGER,
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(warehouse, sku)
);

CREATE INDEX IF NOT EXISTS idx_fba_aging_iwasku ON fba_inventory_aging(iwasku);
CREATE INDEX IF NOT EXISTS idx_fba_aging_warehouse ON fba_inventory_aging(warehouse);
CREATE INDEX IF NOT EXISTS idx_fba_aging_asin ON fba_inventory_aging(asin);

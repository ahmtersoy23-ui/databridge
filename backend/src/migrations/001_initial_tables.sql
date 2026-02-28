-- DataBridge initial schema

-- Raw order data fetched from SP-API
CREATE TABLE IF NOT EXISTS raw_orders (
  id SERIAL PRIMARY KEY,
  marketplace_id VARCHAR(20) NOT NULL,
  channel VARCHAR(10) NOT NULL,
  amazon_order_id VARCHAR(50) NOT NULL,
  purchase_date TIMESTAMPTZ NOT NULL,
  purchase_date_local DATE NOT NULL,
  sku VARCHAR(100),
  asin VARCHAR(20),
  iwasku VARCHAR(50),
  quantity INTEGER DEFAULT 0,
  item_price DECIMAL(12,2) DEFAULT 0,
  currency VARCHAR(5),
  order_status VARCHAR(30),
  fulfillment_channel VARCHAR(10),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(amazon_order_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_raw_orders_channel_date ON raw_orders(channel, purchase_date_local);
CREATE INDEX IF NOT EXISTS idx_raw_orders_iwasku ON raw_orders(iwasku);
CREATE INDEX IF NOT EXISTS idx_raw_orders_asin ON raw_orders(asin);

-- FBA inventory snapshot (updated on each sync)
CREATE TABLE IF NOT EXISTS fba_inventory (
  id SERIAL PRIMARY KEY,
  warehouse VARCHAR(10) NOT NULL,
  marketplace_id VARCHAR(20) NOT NULL,
  sku VARCHAR(100),
  asin VARCHAR(20),
  fnsku VARCHAR(20),
  iwasku VARCHAR(50),
  fulfillable_quantity INTEGER DEFAULT 0,
  total_reserved_quantity INTEGER DEFAULT 0,
  pending_customer_order_quantity INTEGER DEFAULT 0,
  pending_transshipment_quantity INTEGER DEFAULT 0,
  fc_processing_quantity INTEGER DEFAULT 0,
  total_unfulfillable_quantity INTEGER DEFAULT 0,
  customer_damaged_quantity INTEGER DEFAULT 0,
  warehouse_damaged_quantity INTEGER DEFAULT 0,
  distributor_damaged_quantity INTEGER DEFAULT 0,
  inbound_shipped_quantity INTEGER DEFAULT 0,
  inbound_working_quantity INTEGER DEFAULT 0,
  inbound_receiving_quantity INTEGER DEFAULT 0,
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(warehouse, sku)
);

CREATE INDEX IF NOT EXISTS idx_fba_inventory_iwasku ON fba_inventory(iwasku);

-- Sync job tracking
CREATE TABLE IF NOT EXISTS sync_jobs (
  id SERIAL PRIMARY KEY,
  job_type VARCHAR(30) NOT NULL,
  marketplace VARCHAR(10),
  status VARCHAR(20) DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  records_processed INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_type_status ON sync_jobs(job_type, status);

-- SP-API credentials
CREATE TABLE IF NOT EXISTS sp_api_credentials (
  id SERIAL PRIMARY KEY,
  region VARCHAR(10) NOT NULL,
  seller_id VARCHAR(50),
  refresh_token TEXT NOT NULL,
  client_id VARCHAR(200) NOT NULL,
  client_secret TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Marketplace configuration
CREATE TABLE IF NOT EXISTS marketplace_config (
  marketplace_id VARCHAR(20) PRIMARY KEY,
  country_code VARCHAR(5) NOT NULL,
  channel VARCHAR(10) NOT NULL,
  warehouse VARCHAR(10) NOT NULL,
  region VARCHAR(10) NOT NULL,
  timezone_offset DECIMAL(4,1) NOT NULL,
  is_active BOOLEAN DEFAULT true
);

-- Seed marketplace config
INSERT INTO marketplace_config (marketplace_id, country_code, channel, warehouse, region, timezone_offset, is_active) VALUES
  ('ATVPDKIKX0DER',  'US', 'us', 'US', 'NA', -8,   true),
  ('A2EUQ1WTGCTBG2', 'CA', 'ca', 'CA', 'NA', -8,   true),
  ('A1F83G8C2ARO7P', 'UK', 'uk', 'UK', 'EU', 0,    true),
  ('A1PA6795UKMFR9', 'DE', 'de', 'EU', 'EU', 1,    true),
  ('A13V1IB3VIYZZH', 'FR', 'fr', 'EU', 'EU', 1,    true),
  ('APJ6JRA9NG5V4',  'IT', 'it', 'EU', 'EU', 1,    true),
  ('A1RKKUPIHCS9HS', 'ES', 'es', 'EU', 'EU', 1,    true),
  ('A39IBJ37TRP1C6', 'AU', 'au', 'AU', 'FE', 10,   true),
  ('A2VIGQ35RCS4UG', 'AE', 'ae', 'EU', 'EU', 4,    false),
  ('A17E79C6D8DWNP', 'SA', 'sa', 'EU', 'EU', 3,    false)
ON CONFLICT (marketplace_id) DO NOTHING;

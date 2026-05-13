-- Bol.com Retailer API integration (multi-account: Pera + OneBV, FBR fulfillment)

CREATE TABLE IF NOT EXISTS bol_credentials (
  id SERIAL PRIMARY KEY,
  label VARCHAR(50) UNIQUE NOT NULL,           -- 'pera' | 'onebv'
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,                  -- encrypted
  channel VARCHAR(20) NOT NULL,                 -- 'bol_pera' | 'bol_onebv' (sales_data.channel)
  use_sandbox BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Raw orders — one row per orderItem (Bol returns items array per order)
CREATE TABLE IF NOT EXISTS bol_raw_orders (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES bol_credentials(id) ON DELETE CASCADE,
  order_id VARCHAR(50) NOT NULL,
  order_item_id VARCHAR(50) NOT NULL,
  order_placed_at TIMESTAMPTZ NOT NULL,
  order_date_local DATE NOT NULL,
  sku VARCHAR(100),                             -- offer.reference (seller SKU)
  ean VARCHAR(20),
  iwasku VARCHAR(50),
  product_title TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  unit_price DECIMAL(12,2) DEFAULT 0,
  item_price DECIMAL(12,2) DEFAULT 0,
  currency VARCHAR(5) DEFAULT 'EUR',
  fulfilment_method VARCHAR(10),                -- 'FBR' | 'FBB'
  is_cancelled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id, order_item_id)
);

CREATE INDEX IF NOT EXISTS idx_bol_raw_orders_account_date ON bol_raw_orders(account_id, order_date_local);
CREATE INDEX IF NOT EXISTS idx_bol_raw_orders_iwasku ON bol_raw_orders(iwasku);
CREATE INDEX IF NOT EXISTS idx_bol_raw_orders_sku ON bol_raw_orders(sku);
CREATE INDEX IF NOT EXISTS idx_bol_raw_orders_ean ON bol_raw_orders(ean);

-- Manual SKU->iwasku mapping (shared across Bol accounts)
CREATE TABLE IF NOT EXISTS bol_sku_mapping (
  sku VARCHAR(100) PRIMARY KEY,
  iwasku VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bol_sku_mapping_iwasku ON bol_sku_mapping(iwasku);

GRANT ALL PRIVILEGES ON TABLE bol_credentials TO pricelab_user;
GRANT ALL PRIVILEGES ON TABLE bol_credentials TO pricelab;
GRANT ALL PRIVILEGES ON TABLE bol_raw_orders TO pricelab_user;
GRANT ALL PRIVILEGES ON TABLE bol_raw_orders TO pricelab;
GRANT ALL PRIVILEGES ON TABLE bol_sku_mapping TO pricelab_user;
GRANT ALL PRIVILEGES ON TABLE bol_sku_mapping TO pricelab;
GRANT USAGE, SELECT ON SEQUENCE bol_credentials_id_seq TO pricelab_user;
GRANT USAGE, SELECT ON SEQUENCE bol_credentials_id_seq TO pricelab;
GRANT USAGE, SELECT ON SEQUENCE bol_raw_orders_id_seq TO pricelab_user;
GRANT USAGE, SELECT ON SEQUENCE bol_raw_orders_id_seq TO pricelab;

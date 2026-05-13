-- Kaufland Marketplace Seller API integration
-- Auth: HMAC-SHA256 (Shop-Client-Key + Shop-Timestamp + Shop-Signature)
-- Base URL: https://sellerapi.kaufland.com/v2
-- Multi-storefront supported per credential (de_DE, cs_CZ, sk_SK, pl_PL, de_AT)

CREATE TABLE IF NOT EXISTS kaufland_credentials (
  id SERIAL PRIMARY KEY,
  label VARCHAR(50) UNIQUE NOT NULL,            -- e.g. 'de-main'
  client_key VARCHAR(64) NOT NULL,              -- 32-char public key
  secret_key TEXT NOT NULL,                     -- 64-char secret, encrypted at rest
  storefront VARCHAR(10) NOT NULL DEFAULT 'de_DE',
  channel VARCHAR(30) NOT NULL DEFAULT 'kaufland_de',   -- sales_data channel code
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Raw orders / line items (one row per order unit, like Walmart)
CREATE TABLE IF NOT EXISTS kaufland_raw_orders (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES kaufland_credentials(id) ON DELETE CASCADE,
  id_order VARCHAR(50) NOT NULL,                -- Kaufland's order ID (e.g. 'MHRYPC1')
  id_order_unit VARCHAR(50) NOT NULL UNIQUE,    -- line-item unique ID
  storefront VARCHAR(10) NOT NULL,
  order_date TIMESTAMPTZ NOT NULL,
  order_date_local DATE NOT NULL,
  ean VARCHAR(20),
  offer_sku VARCHAR(100),                       -- seller's SKU
  product_title TEXT,
  product_id_unit VARCHAR(50),                  -- Kaufland's internal product ID
  iwasku VARCHAR(50),
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price DECIMAL(12,2) DEFAULT 0,
  item_price DECIMAL(12,2) DEFAULT 0,           -- quantity * unit_price (line total)
  currency VARCHAR(5) DEFAULT 'EUR',
  status VARCHAR(30),                            -- e.g. 'new', 'sent', 'cancelled'
  is_cancelled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kaufland_raw_orders_account ON kaufland_raw_orders(account_id);
CREATE INDEX IF NOT EXISTS idx_kaufland_raw_orders_date ON kaufland_raw_orders(order_date_local);
CREATE INDEX IF NOT EXISTS idx_kaufland_raw_orders_iwasku ON kaufland_raw_orders(iwasku);
CREATE INDEX IF NOT EXISTS idx_kaufland_raw_orders_ean ON kaufland_raw_orders(ean);
CREATE INDEX IF NOT EXISTS idx_kaufland_raw_orders_sku ON kaufland_raw_orders(offer_sku);
CREATE INDEX IF NOT EXISTS idx_kaufland_raw_orders_id_order ON kaufland_raw_orders(id_order);

-- Inventory / units snapshot from GET /units (overwritten on each sync)
CREATE TABLE IF NOT EXISTS kaufland_inventory (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES kaufland_credentials(id) ON DELETE CASCADE,
  id_unit VARCHAR(50) NOT NULL,                 -- Kaufland's unit/offer ID
  ean VARCHAR(20),
  offer_sku VARCHAR(100),
  product_title TEXT,
  storefront VARCHAR(10),
  amount INTEGER DEFAULT 0,                     -- stock on Kaufland
  reserved_amount INTEGER DEFAULT 0,
  price DECIMAL(12,2),
  status VARCHAR(30),
  iwasku VARCHAR(50),
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, id_unit)
);

CREATE INDEX IF NOT EXISTS idx_kaufland_inventory_iwasku ON kaufland_inventory(iwasku);
CREATE INDEX IF NOT EXISTS idx_kaufland_inventory_ean ON kaufland_inventory(ean);
CREATE INDEX IF NOT EXISTS idx_kaufland_inventory_sku ON kaufland_inventory(offer_sku);

-- Manual SKU/EAN -> iwasku mapping (per account)
CREATE TABLE IF NOT EXISTS kaufland_sku_mapping (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES kaufland_credentials(id) ON DELETE CASCADE,
  marketplace_sku VARCHAR(100) NOT NULL,        -- can be EAN, offer_sku or product_id_unit
  iwasku VARCHAR(50) NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, marketplace_sku)
);

CREATE INDEX IF NOT EXISTS idx_kaufland_sku_mapping_iwasku ON kaufland_sku_mapping(iwasku);

-- Permissions for databridge_user (write) + pricelab/pricelab_user (read+write via app)
GRANT ALL PRIVILEGES ON TABLE kaufland_credentials TO pricelab_user;
GRANT ALL PRIVILEGES ON TABLE kaufland_credentials TO pricelab;
GRANT ALL PRIVILEGES ON TABLE kaufland_raw_orders TO pricelab_user;
GRANT ALL PRIVILEGES ON TABLE kaufland_raw_orders TO pricelab;
GRANT ALL PRIVILEGES ON TABLE kaufland_inventory TO pricelab_user;
GRANT ALL PRIVILEGES ON TABLE kaufland_inventory TO pricelab;
GRANT ALL PRIVILEGES ON TABLE kaufland_sku_mapping TO pricelab_user;
GRANT ALL PRIVILEGES ON TABLE kaufland_sku_mapping TO pricelab;
GRANT USAGE, SELECT ON SEQUENCE kaufland_credentials_id_seq TO pricelab_user;
GRANT USAGE, SELECT ON SEQUENCE kaufland_credentials_id_seq TO pricelab;
GRANT USAGE, SELECT ON SEQUENCE kaufland_raw_orders_id_seq TO pricelab_user;
GRANT USAGE, SELECT ON SEQUENCE kaufland_raw_orders_id_seq TO pricelab;
GRANT USAGE, SELECT ON SEQUENCE kaufland_inventory_id_seq TO pricelab_user;
GRANT USAGE, SELECT ON SEQUENCE kaufland_inventory_id_seq TO pricelab;
GRANT USAGE, SELECT ON SEQUENCE kaufland_sku_mapping_id_seq TO pricelab_user;
GRANT USAGE, SELECT ON SEQUENCE kaufland_sku_mapping_id_seq TO pricelab;

-- StockPulse reads via stockpulse_reader (databridgePool / SHARED_DB_USER)
-- Without these grants StockPulse's Kaufland page silently 500s.
GRANT SELECT ON kaufland_inventory TO stockpulse_reader;
GRANT SELECT ON kaufland_raw_orders TO stockpulse_reader;
GRANT SELECT ON kaufland_sku_mapping TO stockpulse_reader;

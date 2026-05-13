-- Takealot Seller API integration (single account, South Africa marketplace)

CREATE TABLE IF NOT EXISTS takealot_credentials (
  id SERIAL PRIMARY KEY,
  label VARCHAR(50) UNIQUE NOT NULL DEFAULT 'za-main',
  api_key TEXT NOT NULL,                        -- encrypted
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Raw sales (line-level) from /v2/sales
CREATE TABLE IF NOT EXISTS takealot_raw_orders (
  id SERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL,
  order_item_id BIGINT NOT NULL UNIQUE,         -- Takealot's unique per-line ID
  order_date TIMESTAMPTZ NOT NULL,
  order_date_local DATE NOT NULL,
  sku VARCHAR(100),
  tsin BIGINT,                                  -- Takealot product ID
  iwasku VARCHAR(50),
  product_title TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  selling_price DECIMAL(12,2) DEFAULT 0,
  item_price DECIMAL(12,2) DEFAULT 0,           -- quantity * selling_price (line total)
  currency VARCHAR(5) DEFAULT 'ZAR',
  dc VARCHAR(20),                                -- fulfillment DC (e.g. JHB, CPT)
  customer_dc VARCHAR(20),                       -- customer DC region
  sale_status BOOLEAN,                           -- true=settled/shipped, false=cancelled
  promotion BOOLEAN,
  stock_source_region VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_takealot_raw_orders_date ON takealot_raw_orders(order_date_local);
CREATE INDEX IF NOT EXISTS idx_takealot_raw_orders_iwasku ON takealot_raw_orders(iwasku);
CREATE INDEX IF NOT EXISTS idx_takealot_raw_orders_sku ON takealot_raw_orders(sku);
CREATE INDEX IF NOT EXISTS idx_takealot_raw_orders_tsin ON takealot_raw_orders(tsin);
CREATE INDEX IF NOT EXISTS idx_takealot_raw_orders_order_id ON takealot_raw_orders(order_id);

-- Inventory snapshot from /v2/offers (overwritten on each sync)
CREATE TABLE IF NOT EXISTS takealot_inventory (
  id SERIAL PRIMARY KEY,
  offer_id BIGINT NOT NULL UNIQUE,
  sku VARCHAR(100),
  tsin BIGINT,
  iwasku VARCHAR(50),
  product_title TEXT,
  selling_price DECIMAL(12,2),
  status VARCHAR(30),
  stock_at_takealot_total INTEGER DEFAULT 0,    -- TAL DC's combined
  total_stock_on_way INTEGER DEFAULT 0,         -- inbound to TAL
  total_stock_cover INTEGER DEFAULT 0,
  leadtime_days INTEGER,
  warehouse_stock JSONB,                         -- raw stock_at_takealot[] breakdown
  last_synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_takealot_inventory_iwasku ON takealot_inventory(iwasku);
CREATE INDEX IF NOT EXISTS idx_takealot_inventory_sku ON takealot_inventory(sku);

-- Manual SKU -> iwasku mapping
CREATE TABLE IF NOT EXISTS takealot_sku_mapping (
  sku VARCHAR(100) PRIMARY KEY,
  iwasku VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_takealot_sku_mapping_iwasku ON takealot_sku_mapping(iwasku);

GRANT ALL PRIVILEGES ON TABLE takealot_credentials TO pricelab_user;
GRANT ALL PRIVILEGES ON TABLE takealot_credentials TO pricelab;
GRANT ALL PRIVILEGES ON TABLE takealot_raw_orders TO pricelab_user;
GRANT ALL PRIVILEGES ON TABLE takealot_raw_orders TO pricelab;
GRANT ALL PRIVILEGES ON TABLE takealot_inventory TO pricelab_user;
GRANT ALL PRIVILEGES ON TABLE takealot_inventory TO pricelab;
GRANT ALL PRIVILEGES ON TABLE takealot_sku_mapping TO pricelab_user;
GRANT ALL PRIVILEGES ON TABLE takealot_sku_mapping TO pricelab;
GRANT USAGE, SELECT ON SEQUENCE takealot_credentials_id_seq TO pricelab_user;
GRANT USAGE, SELECT ON SEQUENCE takealot_credentials_id_seq TO pricelab;
GRANT USAGE, SELECT ON SEQUENCE takealot_raw_orders_id_seq TO pricelab_user;
GRANT USAGE, SELECT ON SEQUENCE takealot_raw_orders_id_seq TO pricelab;
GRANT USAGE, SELECT ON SEQUENCE takealot_inventory_id_seq TO pricelab_user;
GRANT USAGE, SELECT ON SEQUENCE takealot_inventory_id_seq TO pricelab;

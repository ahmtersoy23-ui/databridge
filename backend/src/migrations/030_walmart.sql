-- Walmart Marketplace integration (US only, seller-fulfilled — no WFS yet)

-- OAuth2 credentials (client_credentials flow)
-- Token TTL is short (15min) so we cache in-memory per process
CREATE TABLE IF NOT EXISTS walmart_credentials (
  id SERIAL PRIMARY KEY,
  label VARCHAR(50) UNIQUE NOT NULL,
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  use_sandbox BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Raw orders from /v3/orders (one row per orderLine)
CREATE TABLE IF NOT EXISTS walmart_raw_orders (
  id SERIAL PRIMARY KEY,
  customer_order_id VARCHAR(50) NOT NULL,
  purchase_order_id VARCHAR(50) NOT NULL,
  order_date TIMESTAMPTZ NOT NULL,
  order_date_local DATE NOT NULL,
  line_number VARCHAR(20) NOT NULL,
  sku VARCHAR(100) NOT NULL,
  iwasku VARCHAR(50),
  product_name TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  unit_price DECIMAL(12,2) DEFAULT 0,
  item_price DECIMAL(12,2) DEFAULT 0,
  currency VARCHAR(5) DEFAULT 'USD',
  order_status VARCHAR(30),
  ship_node_type VARCHAR(30),
  customer_email_marketing VARCHAR(120),
  shipping_postal_code VARCHAR(20),
  shipping_state VARCHAR(50),
  shipping_country VARCHAR(5),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(purchase_order_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_walmart_raw_orders_date ON walmart_raw_orders(order_date_local);
CREATE INDEX IF NOT EXISTS idx_walmart_raw_orders_iwasku ON walmart_raw_orders(iwasku);
CREATE INDEX IF NOT EXISTS idx_walmart_raw_orders_sku ON walmart_raw_orders(sku);
CREATE INDEX IF NOT EXISTS idx_walmart_raw_orders_customer_order ON walmart_raw_orders(customer_order_id);

-- Persistent SKU mapping (sku -> iwasku) for Walmart seller SKUs that differ from iwasku
CREATE TABLE IF NOT EXISTS walmart_sku_mapping (
  sku VARCHAR(100) PRIMARY KEY,
  iwasku VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_walmart_sku_mapping_iwasku ON walmart_sku_mapping(iwasku);

GRANT ALL PRIVILEGES ON TABLE walmart_credentials TO pricelab_user;
GRANT ALL PRIVILEGES ON TABLE walmart_credentials TO pricelab;
GRANT ALL PRIVILEGES ON TABLE walmart_raw_orders TO pricelab_user;
GRANT ALL PRIVILEGES ON TABLE walmart_raw_orders TO pricelab;
GRANT ALL PRIVILEGES ON TABLE walmart_sku_mapping TO pricelab_user;
GRANT ALL PRIVILEGES ON TABLE walmart_sku_mapping TO pricelab;
GRANT USAGE, SELECT ON SEQUENCE walmart_credentials_id_seq TO pricelab_user;
GRANT USAGE, SELECT ON SEQUENCE walmart_credentials_id_seq TO pricelab;
GRANT USAGE, SELECT ON SEQUENCE walmart_raw_orders_id_seq TO pricelab_user;
GRANT USAGE, SELECT ON SEQUENCE walmart_raw_orders_id_seq TO pricelab;

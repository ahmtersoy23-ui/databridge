CREATE TABLE IF NOT EXISTS wisersell_products (
  id INTEGER PRIMARY KEY,
  name VARCHAR(500),
  code VARCHAR(100),
  weight DECIMAL(10,4),
  deci DECIMAL(10,4),
  width DECIMAL(10,4),
  length DECIMAL(10,4),
  height DECIMAL(10,4),
  arr_sku JSONB,
  category_id INTEGER,
  extra_data JSONB,
  synced_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wisersell_code ON wisersell_products (code);

CREATE TABLE IF NOT EXISTS wisersell_credentials (
  id INTEGER PRIMARY KEY DEFAULT 1,
  email VARCHAR(255) NOT NULL,
  password TEXT NOT NULL,
  api_url VARCHAR(500) NOT NULL DEFAULT 'https://www.wisersell.com/restapi',
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT single_row CHECK (id = 1)
);

-- Wayfair OAuth2 credentials
CREATE TABLE IF NOT EXISTS wayfair_credentials (
  id INTEGER PRIMARY KEY DEFAULT 1,
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  use_sandbox BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT single_row_wayfair CHECK (id = 1)
);

-- Raw inventory snapshot from CastleGate (overwritten on each sync)
CREATE TABLE IF NOT EXISTS wayfair_inventory (
  id SERIAL PRIMARY KEY,
  part_number VARCHAR(100) NOT NULL,
  warehouse_id VARCHAR(50) NOT NULL,
  warehouse_name VARCHAR(200),
  quantity INTEGER DEFAULT 0,
  iwasku VARCHAR(50),
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(part_number, warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_wayfair_inventory_iwasku ON wayfair_inventory (iwasku);
CREATE INDEX IF NOT EXISTS idx_wayfair_inventory_part_number ON wayfair_inventory (part_number);

-- Persistent user-managed mapping: partNumber → iwasku (survives syncs)
CREATE TABLE IF NOT EXISTS wayfair_sku_mapping (
  part_number VARCHAR(100) PRIMARY KEY,
  iwasku VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wayfair_sku_mapping_iwasku ON wayfair_sku_mapping (iwasku);

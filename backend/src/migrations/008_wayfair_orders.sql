-- Wayfair orders table (flat: one row per product line, like Amazon orders)
CREATE TABLE IF NOT EXISTS wayfair_orders (
  id SERIAL PRIMARY KEY,
  po_number VARCHAR(100) NOT NULL,
  po_date TIMESTAMPTZ,
  supplier_id INTEGER,
  order_type VARCHAR(20) NOT NULL, -- 'castlegate' or 'dropship'
  part_number VARCHAR(100) NOT NULL,
  iwasku VARCHAR(50),
  quantity INTEGER DEFAULT 0,
  price NUMERIC(12,2),
  total_cost NUMERIC(12,2),
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(po_number, part_number, order_type)
);

CREATE INDEX IF NOT EXISTS idx_wayfair_orders_part_number ON wayfair_orders (part_number);
CREATE INDEX IF NOT EXISTS idx_wayfair_orders_po_date ON wayfair_orders (po_date DESC);
CREATE INDEX IF NOT EXISTS idx_wayfair_orders_order_type ON wayfair_orders (order_type);

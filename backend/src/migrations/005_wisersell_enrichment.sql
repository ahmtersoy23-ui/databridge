-- Migration 005: Wisersell catalog enrichment
-- Adds size/color columns from extra_data + wisersell_categories table

ALTER TABLE wisersell_products
  ADD COLUMN IF NOT EXISTS size  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS color VARCHAR(100);

-- Backfill from existing extra_data
UPDATE wisersell_products
SET
  size  = extra_data->>'Size',
  color = extra_data->>'Color'
WHERE extra_data IS NOT NULL;

-- Categories table
CREATE TABLE IF NOT EXISTS wisersell_categories (
  id        INTEGER PRIMARY KEY,
  name      VARCHAR(500),
  synced_at TIMESTAMP DEFAULT NOW()
);

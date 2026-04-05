-- Migration: Add fnsku column to sku_master (pricelab_db)
-- Run on pricelab_db: sudo -u postgres psql -d pricelab_db -f 019_sku_master_fnsku.sql

ALTER TABLE sku_master ADD COLUMN IF NOT EXISTS fnsku VARCHAR(20);
CREATE INDEX IF NOT EXISTS idx_sku_master_fnsku ON sku_master(fnsku);

-- One-time populate from fba_inventory (databridge_db → pricelab_db cross-db)
-- Run separately after migration — see below

-- schema_migrations record
INSERT INTO schema_migrations (app_name, version, description, applied_at)
VALUES ('databridge', '019', 'sku_master_fnsku', NOW())
ON CONFLICT DO NOTHING;

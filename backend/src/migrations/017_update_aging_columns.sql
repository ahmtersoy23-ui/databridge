-- 017_update_aging_columns.sql
-- Update aging columns to match Seller Central CSV format
-- Split 365+ into 366-455 and 456+, add new useful fields

-- Split inv_age_365_plus_days into two columns
ALTER TABLE fba_inventory_aging RENAME COLUMN inv_age_365_plus_days TO inv_age_366_to_455_days;
ALTER TABLE fba_inventory_aging ADD COLUMN IF NOT EXISTS inv_age_456_plus_days INTEGER DEFAULT 0;

-- Rename LTSF to match Seller Central naming
ALTER TABLE fba_inventory_aging RENAME COLUMN estimated_ltsf_next_charge TO estimated_storage_cost_next_month;

-- Add new useful fields from Seller Central report
ALTER TABLE fba_inventory_aging ADD COLUMN IF NOT EXISTS days_of_supply INTEGER;
ALTER TABLE fba_inventory_aging ADD COLUMN IF NOT EXISTS estimated_excess_quantity INTEGER DEFAULT 0;
ALTER TABLE fba_inventory_aging ADD COLUMN IF NOT EXISTS weeks_of_cover_t30 DECIMAL(10,2);
ALTER TABLE fba_inventory_aging ADD COLUMN IF NOT EXISTS weeks_of_cover_t90 DECIMAL(10,2);
ALTER TABLE fba_inventory_aging ADD COLUMN IF NOT EXISTS no_sale_last_6_months INTEGER DEFAULT 0;
ALTER TABLE fba_inventory_aging ADD COLUMN IF NOT EXISTS inbound_quantity INTEGER DEFAULT 0;
ALTER TABLE fba_inventory_aging ADD COLUMN IF NOT EXISTS sales_rank INTEGER;
ALTER TABLE fba_inventory_aging ADD COLUMN IF NOT EXISTS product_group VARCHAR(100);

-- Drop columns no longer needed (SP-API specific)
ALTER TABLE fba_inventory_aging DROP COLUMN IF EXISTS estimated_ltsf_6_mo;
ALTER TABLE fba_inventory_aging DROP COLUMN IF EXISTS estimated_ltsf_12_mo;
ALTER TABLE fba_inventory_aging DROP COLUMN IF EXISTS estimated_cost_savings;
ALTER TABLE fba_inventory_aging DROP COLUMN IF EXISTS healthy_inventory_level;
ALTER TABLE fba_inventory_aging DROP COLUMN IF EXISTS per_unit_volume;
ALTER TABLE fba_inventory_aging DROP COLUMN IF EXISTS is_hazmat;
ALTER TABLE fba_inventory_aging DROP COLUMN IF EXISTS in_date;

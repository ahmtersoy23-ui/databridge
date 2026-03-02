-- Migration 003: NJ physical warehouse inventory table
-- Date: 2026-03-02
-- Description: Stores IWA NJ warehouse inventory data fetched from
--   https://iwarden.iwaconcept.com/iwabot/warehouse/report.php?csv=1
--   Enriched with iwasku/asin from fba_inventory via FNSKU lookup.

CREATE TABLE IF NOT EXISTS nj_warehouse_inventory (
  fnsku VARCHAR(50) PRIMARY KEY,
  name VARCHAR(500),
  category VARCHAR(100),
  count_in_ship INTEGER DEFAULT 0,
  count_in_raf INTEGER DEFAULT 0,
  total_count INTEGER DEFAULT 0,
  iwasku VARCHAR(100),
  asin VARCHAR(20),
  synced_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nj_warehouse_iwasku ON nj_warehouse_inventory (iwasku);

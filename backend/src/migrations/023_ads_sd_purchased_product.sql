-- Migration 023: SD Purchased Product Report (Brand Halo)
-- Run: ssh -p 2222 root@78.47.117.36 "sudo -u postgres psql -d databridge_db -f /tmp/023_ads_sd_purchased_product.sql"

BEGIN;

CREATE TABLE IF NOT EXISTS ads_sd_purchased_product_report (
  id              SERIAL PRIMARY KEY,
  profile_id      BIGINT NOT NULL,
  report_date     DATE NOT NULL,
  campaign_id     BIGINT NOT NULL,
  campaign_name   TEXT,
  ad_group_id     BIGINT,
  ad_group_name   TEXT,
  advertised_asin TEXT,
  advertised_sku  TEXT,
  purchased_asin  TEXT NOT NULL,
  orders_14d      INT DEFAULT 0,
  units_14d       INT DEFAULT 0,
  sales_14d       NUMERIC(12,2) DEFAULT 0,
  synced_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_ads_sd_purchased UNIQUE (profile_id, report_date, campaign_id, ad_group_id, advertised_asin, purchased_asin)
);

CREATE INDEX IF NOT EXISTS idx_sd_purchased_report_date ON ads_sd_purchased_product_report (report_date);
CREATE INDEX IF NOT EXISTS idx_sd_purchased_asin ON ads_sd_purchased_product_report (purchased_asin, report_date);

COMMIT;

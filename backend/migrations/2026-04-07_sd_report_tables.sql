-- SD (Sponsored Display) report tables
-- Run: ssh -p 2222 root@78.47.117.36 "sudo -u postgres psql -d databridge_db -f /tmp/sd_tables.sql"

CREATE TABLE IF NOT EXISTS ads_sd_campaign_report (
  id SERIAL PRIMARY KEY,
  profile_id BIGINT NOT NULL,
  report_date DATE NOT NULL,
  campaign_id BIGINT,
  campaign_name TEXT,
  impressions INT DEFAULT 0,
  clicks INT DEFAULT 0,
  spend NUMERIC(12,2) DEFAULT 0,
  sales_14d NUMERIC(12,2) DEFAULT 0,
  orders_14d INT DEFAULT 0,
  units_14d INT DEFAULT 0,
  dpv_14d INT DEFAULT 0,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(profile_id, report_date, campaign_id)
);

CREATE TABLE IF NOT EXISTS ads_sd_targeting_report (
  id SERIAL PRIMARY KEY,
  profile_id BIGINT NOT NULL,
  report_date DATE NOT NULL,
  campaign_id BIGINT,
  campaign_name TEXT,
  ad_group_id BIGINT,
  ad_group_name TEXT,
  targeting TEXT,
  impressions INT DEFAULT 0,
  clicks INT DEFAULT 0,
  spend NUMERIC(12,2) DEFAULT 0,
  sales_14d NUMERIC(12,2) DEFAULT 0,
  orders_14d INT DEFAULT 0,
  units_14d INT DEFAULT 0,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(profile_id, report_date, campaign_id, ad_group_id, targeting)
);

CREATE TABLE IF NOT EXISTS ads_sd_advertised_product_report (
  id SERIAL PRIMARY KEY,
  profile_id BIGINT NOT NULL,
  report_date DATE NOT NULL,
  campaign_id BIGINT,
  campaign_name TEXT,
  ad_group_id BIGINT,
  ad_group_name TEXT,
  advertised_asin VARCHAR(20),
  advertised_sku VARCHAR(100),
  impressions INT DEFAULT 0,
  clicks INT DEFAULT 0,
  spend NUMERIC(12,2) DEFAULT 0,
  sales_14d NUMERIC(12,2) DEFAULT 0,
  orders_14d INT DEFAULT 0,
  units_14d INT DEFAULT 0,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(profile_id, report_date, campaign_id, ad_group_id, advertised_asin)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_sd_campaign_profile_date ON ads_sd_campaign_report(profile_id, report_date);
CREATE INDEX IF NOT EXISTS idx_sd_targeting_profile_date ON ads_sd_targeting_report(profile_id, report_date);
CREATE INDEX IF NOT EXISTS idx_sd_advprod_profile_date ON ads_sd_advertised_product_report(profile_id, report_date);

-- Migration 021: AdPilot Phase 0 — Business Reports, Campaign Snapshot, Brand Analytics SQP
-- Run: ssh -p 2222 root@78.47.117.36 "sudo -u postgres psql -d databridge_db -f /tmp/021_adpilot_phase0.sql"

BEGIN;

-- 1. Business Reports (ASIN x day: traffic, conversion, buy box)
CREATE TABLE IF NOT EXISTS business_report (
  id              SERIAL PRIMARY KEY,
  credential_id   INT NOT NULL,
  marketplace_id  TEXT NOT NULL,
  report_date     DATE NOT NULL,
  parent_asin     TEXT,
  child_asin      TEXT NOT NULL,
  title           TEXT,
  sessions        INT DEFAULT 0,
  session_percentage NUMERIC(8,4) DEFAULT 0,
  page_views      INT DEFAULT 0,
  page_views_percentage NUMERIC(8,4) DEFAULT 0,
  buy_box_percentage NUMERIC(8,4) DEFAULT 0,
  units_ordered   INT DEFAULT 0,
  units_ordered_b2b INT DEFAULT 0,
  unit_session_percentage NUMERIC(8,4) DEFAULT 0,
  unit_session_percentage_b2b NUMERIC(8,4) DEFAULT 0,
  ordered_product_sales NUMERIC(14,2) DEFAULT 0,
  ordered_product_sales_b2b NUMERIC(14,2) DEFAULT 0,
  total_order_items INT DEFAULT 0,
  total_order_items_b2b INT DEFAULT 0,
  synced_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_business_report UNIQUE (credential_id, marketplace_id, report_date, child_asin)
);

CREATE INDEX IF NOT EXISTS idx_business_report_asin_date ON business_report (child_asin, report_date);
CREATE INDEX IF NOT EXISTS idx_business_report_date ON business_report (report_date);

-- 2. Campaign Structure Snapshot
CREATE TABLE IF NOT EXISTS ads_campaigns_snapshot (
  id              SERIAL PRIMARY KEY,
  profile_id      BIGINT NOT NULL,
  campaign_id     BIGINT NOT NULL,
  campaign_name   TEXT,
  campaign_type   TEXT,
  targeting_type  TEXT,
  state           TEXT,
  daily_budget    NUMERIC(12,2),
  start_date      TEXT,
  end_date        TEXT,
  bidding_strategy TEXT,
  portfolio_id    BIGINT,
  snapshot_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  synced_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_campaigns_snapshot UNIQUE (profile_id, campaign_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_campaigns_snapshot_date ON ads_campaigns_snapshot (snapshot_date);

CREATE TABLE IF NOT EXISTS ads_product_ads_snapshot (
  id              SERIAL PRIMARY KEY,
  profile_id      BIGINT NOT NULL,
  ad_id           BIGINT NOT NULL,
  campaign_id     BIGINT NOT NULL,
  ad_group_id     BIGINT NOT NULL,
  asin            TEXT,
  sku             TEXT,
  state           TEXT,
  snapshot_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  synced_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_product_ads_snapshot UNIQUE (profile_id, ad_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_product_ads_snapshot_date ON ads_product_ads_snapshot (snapshot_date);
CREATE INDEX IF NOT EXISTS idx_product_ads_snapshot_campaign ON ads_product_ads_snapshot (campaign_id, snapshot_date);

-- 3. Brand Analytics SQP (Search Query Performance)
CREATE TABLE IF NOT EXISTS brand_analytics_sqp (
  id              SERIAL PRIMARY KEY,
  credential_id   INT NOT NULL,
  marketplace_id  TEXT NOT NULL,
  report_date     DATE NOT NULL,
  department      TEXT,
  search_term     TEXT NOT NULL,
  search_frequency_rank INT,
  click_share     NUMERIC(8,4) DEFAULT 0,
  conversion_share NUMERIC(8,4) DEFAULT 0,
  clicked_asin    TEXT,
  clicked_asin_product_name TEXT,
  synced_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_brand_analytics_sqp UNIQUE (credential_id, marketplace_id, report_date, search_term, clicked_asin)
);

CREATE INDEX IF NOT EXISTS idx_brand_analytics_sqp_term ON brand_analytics_sqp (search_term, report_date);
CREATE INDEX IF NOT EXISTS idx_brand_analytics_sqp_asin ON brand_analytics_sqp (clicked_asin, report_date);
CREATE INDEX IF NOT EXISTS idx_brand_analytics_sqp_date ON brand_analytics_sqp (report_date);

COMMIT;

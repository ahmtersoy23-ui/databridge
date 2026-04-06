-- Migration 022: Ads Tier 1 Reports — Placement, Campaign, SB Campaign, SB Search Term
-- Run: ssh -p 2222 root@78.47.117.36 "sudo -u postgres psql -d databridge_db -f /tmp/022_ads_tier1_reports.sql"

BEGIN;

-- 1. SP Placement Report (campaign × placement × day)
CREATE TABLE IF NOT EXISTS ads_placement_report (
  id              SERIAL PRIMARY KEY,
  profile_id      BIGINT NOT NULL,
  report_date     DATE NOT NULL,
  campaign_id     BIGINT NOT NULL,
  campaign_name   TEXT,
  placement       TEXT NOT NULL,
  impressions     INT DEFAULT 0,
  clicks          INT DEFAULT 0,
  spend           NUMERIC(12,2) DEFAULT 0,
  sales_7d        NUMERIC(12,2) DEFAULT 0,
  orders_7d       INT DEFAULT 0,
  units_7d        INT DEFAULT 0,
  synced_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_ads_placement UNIQUE (profile_id, report_date, campaign_id, placement)
);

CREATE INDEX IF NOT EXISTS idx_placement_report_date ON ads_placement_report (report_date);
CREATE INDEX IF NOT EXISTS idx_placement_report_campaign ON ads_placement_report (campaign_id, report_date);

-- 2. SP Campaign Report (campaign × day)
CREATE TABLE IF NOT EXISTS ads_campaign_report (
  id              SERIAL PRIMARY KEY,
  profile_id      BIGINT NOT NULL,
  report_date     DATE NOT NULL,
  campaign_id     BIGINT NOT NULL,
  campaign_name   TEXT,
  campaign_status TEXT,
  budget          NUMERIC(12,2),
  impressions     INT DEFAULT 0,
  clicks          INT DEFAULT 0,
  spend           NUMERIC(12,2) DEFAULT 0,
  sales_7d        NUMERIC(12,2) DEFAULT 0,
  orders_7d       INT DEFAULT 0,
  units_7d        INT DEFAULT 0,
  synced_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_ads_campaign UNIQUE (profile_id, report_date, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_report_date ON ads_campaign_report (report_date);

-- 3. SB Campaign Report (Sponsored Brands — 14d attribution)
CREATE TABLE IF NOT EXISTS ads_sb_campaign_report (
  id              SERIAL PRIMARY KEY,
  profile_id      BIGINT NOT NULL,
  report_date     DATE NOT NULL,
  campaign_id     BIGINT NOT NULL,
  campaign_name   TEXT,
  impressions     INT DEFAULT 0,
  clicks          INT DEFAULT 0,
  spend           NUMERIC(12,2) DEFAULT 0,
  sales_14d       NUMERIC(12,2) DEFAULT 0,
  orders_14d      INT DEFAULT 0,
  units_14d       INT DEFAULT 0,
  new_to_brand_purchases_14d INT DEFAULT 0,
  new_to_brand_sales_14d NUMERIC(12,2) DEFAULT 0,
  dpv_14d         INT DEFAULT 0,
  synced_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_ads_sb_campaign UNIQUE (profile_id, report_date, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_sb_campaign_report_date ON ads_sb_campaign_report (report_date);

-- 4. SB Search Term Report (Sponsored Brands — 14d attribution)
CREATE TABLE IF NOT EXISTS ads_sb_search_term_report (
  id              SERIAL PRIMARY KEY,
  profile_id      BIGINT NOT NULL,
  report_date     DATE NOT NULL,
  campaign_id     BIGINT NOT NULL,
  campaign_name   TEXT,
  ad_group_id     BIGINT,
  ad_group_name   TEXT,
  search_term     TEXT NOT NULL,
  impressions     INT DEFAULT 0,
  clicks          INT DEFAULT 0,
  spend           NUMERIC(12,2) DEFAULT 0,
  sales_14d       NUMERIC(12,2) DEFAULT 0,
  orders_14d      INT DEFAULT 0,
  synced_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_ads_sb_search_term UNIQUE (profile_id, report_date, campaign_id, ad_group_id, search_term)
);

CREATE INDEX IF NOT EXISTS idx_sb_search_term_date ON ads_sb_search_term_report (report_date);
CREATE INDEX IF NOT EXISTS idx_sb_search_term_term ON ads_sb_search_term_report (search_term, report_date);

COMMIT;

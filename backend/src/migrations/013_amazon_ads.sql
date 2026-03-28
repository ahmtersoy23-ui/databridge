-- 013_amazon_ads.sql
-- Amazon Ads API entegrasyonu: profil, 4 rapor tablosu, sync job tracking

-- sp_api_credentials'a ads_refresh_token kolonu ekle (nullable)
ALTER TABLE sp_api_credentials ADD COLUMN IF NOT EXISTS ads_refresh_token TEXT;

-- Ads API profilleri (marketplace başına bir profil)
CREATE TABLE IF NOT EXISTS ads_api_profiles (
  id SERIAL PRIMARY KEY,
  credential_id INTEGER NOT NULL REFERENCES sp_api_credentials(id),
  profile_id BIGINT NOT NULL UNIQUE,
  country_code VARCHAR(5) NOT NULL,
  marketplace_id VARCHAR(20),
  account_name VARCHAR(200),
  account_type VARCHAR(20),  -- 'seller' or 'vendor'
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ads_profiles_credential ON ads_api_profiles(credential_id);
CREATE INDEX IF NOT EXISTS idx_ads_profiles_country ON ads_api_profiles(country_code);

-- Search Term Report
CREATE TABLE IF NOT EXISTS ads_search_term_report (
  id SERIAL PRIMARY KEY,
  profile_id BIGINT NOT NULL,
  report_date DATE NOT NULL,
  portfolio_name VARCHAR(500),
  currency VARCHAR(10),
  campaign_name VARCHAR(500),
  campaign_id BIGINT,
  ad_group_name VARCHAR(500),
  ad_group_id BIGINT,
  country VARCHAR(10),
  targeting VARCHAR(500),
  match_type VARCHAR(30),
  customer_search_term VARCHAR(500),
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  ctr DECIMAL(10,6),
  cpc DECIMAL(10,4),
  spend DECIMAL(10,2) DEFAULT 0,
  sales_7d DECIMAL(10,2) DEFAULT 0,
  acos DECIMAL(10,4),
  roas DECIMAL(10,4),
  orders_7d INTEGER DEFAULT 0,
  units_7d INTEGER DEFAULT 0,
  cvr DECIMAL(10,6),
  adv_sku_units_7d INTEGER DEFAULT 0,
  other_sku_units_7d INTEGER DEFAULT 0,
  adv_sku_sales_7d DECIMAL(10,2) DEFAULT 0,
  other_sku_sales_7d DECIMAL(10,2) DEFAULT 0,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(profile_id, report_date, campaign_id, ad_group_id, customer_search_term, targeting, match_type)
);

CREATE INDEX IF NOT EXISTS idx_ads_st_profile_date ON ads_search_term_report(profile_id, report_date);
CREATE INDEX IF NOT EXISTS idx_ads_st_campaign ON ads_search_term_report(campaign_name);
CREATE INDEX IF NOT EXISTS idx_ads_st_search_term ON ads_search_term_report(customer_search_term);

-- Targeting Report
CREATE TABLE IF NOT EXISTS ads_targeting_report (
  id SERIAL PRIMARY KEY,
  profile_id BIGINT NOT NULL,
  report_date DATE NOT NULL,
  portfolio_name VARCHAR(500),
  currency VARCHAR(10),
  campaign_name VARCHAR(500),
  campaign_id BIGINT,
  country VARCHAR(10),
  ad_group_name VARCHAR(500),
  ad_group_id BIGINT,
  targeting VARCHAR(500),
  match_type VARCHAR(30),
  impressions INTEGER DEFAULT 0,
  top_of_search_impression_share DECIMAL(10,4),
  clicks INTEGER DEFAULT 0,
  ctr DECIMAL(10,6),
  cpc DECIMAL(10,4),
  spend DECIMAL(10,2) DEFAULT 0,
  acos DECIMAL(10,4),
  roas DECIMAL(10,4),
  sales_7d DECIMAL(10,2) DEFAULT 0,
  orders_7d INTEGER DEFAULT 0,
  units_7d INTEGER DEFAULT 0,
  cvr DECIMAL(10,6),
  adv_sku_units_7d INTEGER DEFAULT 0,
  other_sku_units_7d INTEGER DEFAULT 0,
  adv_sku_sales_7d DECIMAL(10,2) DEFAULT 0,
  other_sku_sales_7d DECIMAL(10,2) DEFAULT 0,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(profile_id, report_date, campaign_id, ad_group_id, targeting, match_type)
);

CREATE INDEX IF NOT EXISTS idx_ads_tgt_profile_date ON ads_targeting_report(profile_id, report_date);

-- Advertised Product Report
CREATE TABLE IF NOT EXISTS ads_advertised_product_report (
  id SERIAL PRIMARY KEY,
  profile_id BIGINT NOT NULL,
  report_date DATE NOT NULL,
  portfolio_name VARCHAR(500),
  currency VARCHAR(10),
  campaign_name VARCHAR(500),
  campaign_id BIGINT,
  ad_group_name VARCHAR(500),
  ad_group_id BIGINT,
  country VARCHAR(10),
  advertised_sku VARCHAR(100),
  advertised_asin VARCHAR(20),
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  ctr DECIMAL(10,6),
  cpc DECIMAL(10,4),
  spend DECIMAL(10,2) DEFAULT 0,
  sales_7d DECIMAL(10,2) DEFAULT 0,
  acos DECIMAL(10,4),
  roas DECIMAL(10,4),
  orders_7d INTEGER DEFAULT 0,
  units_7d INTEGER DEFAULT 0,
  cvr DECIMAL(10,6),
  adv_sku_units_7d INTEGER DEFAULT 0,
  other_sku_units_7d INTEGER DEFAULT 0,
  adv_sku_sales_7d DECIMAL(10,2) DEFAULT 0,
  other_sku_sales_7d DECIMAL(10,2) DEFAULT 0,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(profile_id, report_date, campaign_id, ad_group_id, advertised_asin)
);

CREATE INDEX IF NOT EXISTS idx_ads_ap_profile_date ON ads_advertised_product_report(profile_id, report_date);
CREATE INDEX IF NOT EXISTS idx_ads_ap_asin ON ads_advertised_product_report(advertised_asin);

-- Purchased Product Report
CREATE TABLE IF NOT EXISTS ads_purchased_product_report (
  id SERIAL PRIMARY KEY,
  profile_id BIGINT NOT NULL,
  report_date DATE NOT NULL,
  portfolio_name VARCHAR(500),
  currency VARCHAR(10),
  campaign_name VARCHAR(500),
  campaign_id BIGINT,
  country VARCHAR(10),
  ad_group_name VARCHAR(500),
  ad_group_id BIGINT,
  advertised_sku VARCHAR(100),
  advertised_asin VARCHAR(20),
  targeting VARCHAR(500),
  match_type VARCHAR(30),
  purchased_asin VARCHAR(20),
  other_sku_units_7d INTEGER DEFAULT 0,
  other_sku_orders_7d INTEGER DEFAULT 0,
  other_sku_sales_7d DECIMAL(10,2) DEFAULT 0,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(profile_id, report_date, campaign_id, ad_group_id, advertised_asin, targeting, purchased_asin)
);

CREATE INDEX IF NOT EXISTS idx_ads_pp_profile_date ON ads_purchased_product_report(profile_id, report_date);
CREATE INDEX IF NOT EXISTS idx_ads_pp_purchased_asin ON ads_purchased_product_report(purchased_asin);

-- Ads sync job tracking
CREATE TABLE IF NOT EXISTS ads_sync_jobs (
  id SERIAL PRIMARY KEY,
  profile_id BIGINT NOT NULL,
  report_type VARCHAR(30) NOT NULL,
  report_date DATE,
  date_start DATE,
  date_end DATE,
  status VARCHAR(20) DEFAULT 'pending',
  amazon_report_id VARCHAR(100),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  records_processed INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ads_sync_profile ON ads_sync_jobs(profile_id, report_type);

-- 015_ads_fix_asin_columns.sql
-- Fix: advertised_asin/sku were not being synced from Amazon Ads API.
-- Clean old NULL-ASIN data so re-sync can populate correctly.

-- Advertised Product: delete old rows without ASIN (useless data)
DELETE FROM ads_advertised_product_report WHERE advertised_asin IS NULL;

-- Purchased Product: delete old rows without ASIN data
DELETE FROM ads_purchased_product_report WHERE advertised_asin IS NULL AND purchased_asin IS NULL;

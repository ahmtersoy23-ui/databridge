-- Add iwasku column to review_tracked_asins for non-sku_master products
ALTER TABLE review_tracked_asins ADD COLUMN IF NOT EXISTS iwasku VARCHAR(50);

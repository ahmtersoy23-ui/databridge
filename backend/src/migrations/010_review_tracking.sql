-- Migration 010: Review tracking tables
-- Tracks Amazon product ratings and reviews for monitored ASINs

-- Tracked ASINs list (user-managed)
CREATE TABLE IF NOT EXISTS review_tracked_asins (
  id SERIAL PRIMARY KEY,
  asin VARCHAR(20) NOT NULL,
  country_code VARCHAR(5) NOT NULL DEFAULT 'US',
  label VARCHAR(200),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(asin, country_code)
);

-- Current review snapshot per ASIN+marketplace
CREATE TABLE IF NOT EXISTS product_reviews (
  id SERIAL PRIMARY KEY,
  asin VARCHAR(20) NOT NULL,
  country_code VARCHAR(5) NOT NULL,
  rating DECIMAL(2,1),
  review_count INTEGER DEFAULT 0,
  last_review_text TEXT,
  last_review_title VARCHAR(500),
  last_review_rating INTEGER,
  last_review_date VARCHAR(100),
  last_review_author VARCHAR(200),
  is_blocked BOOLEAN DEFAULT false,
  block_count INTEGER DEFAULT 0,
  checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(asin, country_code)
);

-- Historical rating/review_count for trend analysis
CREATE TABLE IF NOT EXISTS product_reviews_history (
  id SERIAL PRIMARY KEY,
  asin VARCHAR(20) NOT NULL,
  country_code VARCHAR(5) NOT NULL,
  rating DECIMAL(2,1),
  review_count INTEGER DEFAULT 0,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_history_lookup
  ON product_reviews_history(asin, country_code, recorded_at);

-- Review items archive (individual reviews per ASIN)
CREATE TABLE IF NOT EXISTS product_review_items (
  id SERIAL PRIMARY KEY,
  asin VARCHAR(20) NOT NULL,
  country_code VARCHAR(5) NOT NULL,
  title TEXT,
  body VARCHAR(500),
  rating DECIMAL(2,1),
  review_date VARCHAR(200),
  author VARCHAR(200),
  is_verified BOOLEAN DEFAULT false,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(asin, country_code, author, review_date)
);

CREATE INDEX IF NOT EXISTS idx_review_items_lookup
  ON product_review_items(asin, country_code, fetched_at DESC);

-- Grant permissions
GRANT ALL PRIVILEGES ON TABLE product_review_items TO pricelab_user;
GRANT ALL PRIVILEGES ON TABLE product_review_items TO pricelab;
GRANT USAGE, SELECT ON SEQUENCE product_review_items_id_seq TO pricelab_user;
GRANT USAGE, SELECT ON SEQUENCE product_review_items_id_seq TO pricelab;

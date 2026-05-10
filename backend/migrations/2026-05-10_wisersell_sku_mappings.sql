-- Wisersell pazaryeri SKU → iwasku mapping tablosu
-- Run: ssh -p 2222 root@78.47.117.36 \
--   "sudo -u postgres psql -d databridge_db -f /tmp/2026-05-10_wisersell_sku_mappings.sql"
--
-- Wisersell'in kapalı sipariş raporunda her pazaryeri kendi SKU formatını
-- kullanır (Etsy listing variant, Amazon FNSKU/ASIN, Trendyol stockCode...).
-- Shopify'da SKU = iwasku doğal olarak. Diğer pazaryerleri için bu tabloya
-- eşleşme bilgisi girilir, cargolens order detail fallback'ında kullanılır.
--
-- (Wayfair pattern: wayfair_mappings tablosu ile aynı mantık.)

CREATE TABLE IF NOT EXISTS wisersell_sku_mappings (
  platform        TEXT NOT NULL,            -- "Ama_US", "Etsy IWA", "T_CFW", ...
  marketplace_sku TEXT NOT NULL,            -- pazaryerinde görünen SKU
  iwasku          TEXT,                     -- nullable — kullanıcı dolduracak
  notes           TEXT,                     -- istisna durumlar için
  updated_by      TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (platform, marketplace_sku)
);

CREATE INDEX IF NOT EXISTS idx_wsm_iwasku ON wisersell_sku_mappings (iwasku);

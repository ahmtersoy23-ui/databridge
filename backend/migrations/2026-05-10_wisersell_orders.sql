-- Wisersell Kapalı sipariş raporu (sipariş × line item bazında)
-- Run: ssh -p 2222 root@78.47.117.36 \
--   "sudo -u postgres psql -d databridge_db -f /tmp/2026-05-10_wisersell_orders.sql"
--
-- Amaç: Amazon dışı pazaryeri (Etsy, Trendyol, Shopify, vb.) siparişlerinin
-- içeriğini saklamak. Cargolens order-detail endpoint amz_transactions /
-- raw_orders fallback zincirine 3. kaynak olarak eklenir.
-- ETIKET NO formatı "S_IWAUS21462-1/1" → label_base = ilk "-" öncesi kısım,
-- oms_shipments.label_no ile eşleşir.

CREATE TABLE IF NOT EXISTS wisersell_orders (
  id              SERIAL PRIMARY KEY,
  siparis_no      TEXT NOT NULL,
  etiket_no       TEXT,
  label_base      TEXT,                  -- "S_IWAUS21462" (etiket_no'nun "-" öncesi)
  platform        TEXT,                  -- "S_IWAUS", "T_CFW", "Etsy MA", ...
  siparis_tarihi  DATE,
  gonderim_tarihi DATE,
  alici_adi       TEXT,
  email           TEXT,
  adres           TEXT,
  ulke            TEXT,
  urun_id         TEXT,                  -- Wisersell product ID
  urun_kodu       TEXT,                  -- SKU/iwasku
  sku             TEXT,
  urun_basligi    TEXT,
  urun_adi        TEXT,
  varyant         TEXT,
  adet            INTEGER,
  musteri_notu    TEXT,
  urun_aciklamalari TEXT,
  hediye_notu     TEXT,
  kullanici_notu  TEXT,
  kisisellestirme_notu TEXT,
  raw_row         JSONB,
  source_file     TEXT,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Composite unique: bir sipariş × SKU × VARYANT = tek satır
-- COALESCE expression ile NULL varyant'lar da unique check'e dahil
CREATE UNIQUE INDEX IF NOT EXISTS uq_wo_order_sku_var
  ON wisersell_orders (siparis_no, sku, COALESCE(varyant, ''));

CREATE INDEX IF NOT EXISTS idx_wo_siparis ON wisersell_orders (siparis_no);
CREATE INDEX IF NOT EXISTS idx_wo_etiket ON wisersell_orders (etiket_no);
CREATE INDEX IF NOT EXISTS idx_wo_label_base ON wisersell_orders (label_base);
CREATE INDEX IF NOT EXISTS idx_wo_sku ON wisersell_orders (sku);
CREATE INDEX IF NOT EXISTS idx_wo_gonderim ON wisersell_orders (gonderim_tarihi);
CREATE INDEX IF NOT EXISTS idx_wo_platform ON wisersell_orders (platform);

-- FBM stok izleme (geçici diagnostik): seçili Amazon FBM SKU'larının anlık
-- fulfillment_availability.quantity'sini 30 dk'da bir snapshot'lar. Amaç: bizim push'umuz
-- dışında bir kaynağın stoğu 0'ladığını zaman çizelgesiyle yakalamak (DS-002 P9 + 43 çeşitli).
-- ~2026-06-24'te job kendini durdurur (kod end-date guard'lı). Sonra tablo + kod silinebilir.
CREATE TABLE IF NOT EXISTS fbm_qty_tracking (
  id              BIGSERIAL PRIMARY KEY,
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  seller_sku      TEXT NOT NULL,
  amazon_qty      INTEGER,
  listing_exists  BOOLEAN,
  error           TEXT
);
CREATE INDEX IF NOT EXISTS idx_fbm_qty_tracking_sku_time ON fbm_qty_tracking (seller_sku, captured_at);
CREATE INDEX IF NOT EXISTS idx_fbm_qty_tracking_time ON fbm_qty_tracking (captured_at);

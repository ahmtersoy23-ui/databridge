-- wisersell_orders'a iwasku kolonu ekle.
-- Run: ssh -p 2222 root@78.47.117.36 \
--   "sudo -u postgres psql -d databridge_db -f /tmp/2026-05-13_wisersell_orders_iwasku.sql"
--
-- Amaç: StockPulse Global Details sayfası için satır bazlı iwasku resolution.
-- 4-katmanlı fallback chain (cargolens'teki mantık) sync sırasında uygulanır:
--   L1: urun_kodu = products.product_sku  (direkt iwasku)
--   L2: sku_master.sku VEYA .asin → iwasku
--   L3: wisersell_sku_mappings (manuel eşleşmeler)
--   L4: urun_basligi = products.name (title match)
-- resolved_by: hangi katmanda eşleşmiş — telemetri/audit için.

ALTER TABLE wisersell_orders
  ADD COLUMN IF NOT EXISTS iwasku        TEXT,
  ADD COLUMN IF NOT EXISTS resolved_by   TEXT;  -- 'L1_direct' | 'L2_sku_master' | 'L3_mapping' | 'L4_title' | NULL

CREATE INDEX IF NOT EXISTS idx_wo_iwasku ON wisersell_orders (iwasku);
CREATE INDEX IF NOT EXISTS idx_wo_resolved ON wisersell_orders (resolved_by);

-- StockPulse + Cargolens + AI Agent okuma yetkileri korunsun (yeni kolonlar için ek GRANT gerekmez)

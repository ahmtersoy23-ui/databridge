-- sales_data'ya fulfillment_channel kolonu — FBA / FBM / Wayfair / combined ayrımı.
-- Run: ssh -p 2222 root@78.47.117.36 \
--   "sudo -u postgres psql -d pricelab_db -f /tmp/2026-05-13_sales_data_fulfillment.sql"
--
-- Amaç: StockPulse Global'da 'Tümü / Sadece FBA / FBA hariç' toggle desteği.
-- DataBridge writer her iwasku × channel için en fazla 3 satır yazar:
--   - fulfillment_channel = NULL   → combined toplam (eski mantık, geriye uyumlu)
--   - fulfillment_channel = 'Amazon'   → FBA satırı (raw_orders.fulfillment_channel='Amazon')
--   - fulfillment_channel = 'Merchant' → FBM satırı (raw_orders.fulfillment_channel='Merchant')
--   - fulfillment_channel = 'Wayfair'  → Wayfair satırı (wfs/wfm channel'lar için)
--
-- Eski sorgular `WHERE fulfillment_channel IS NULL` ekleyince çift sayım olmaz.

ALTER TABLE sales_data
  ADD COLUMN IF NOT EXISTS fulfillment_channel TEXT;

-- Eski unique constraint'i kaldır, yeni expression-based unique index oluştur
ALTER TABLE sales_data
  DROP CONSTRAINT IF EXISTS sales_data_iwasku_channel_key;

CREATE UNIQUE INDEX IF NOT EXISTS sales_data_unique_ful
  ON sales_data (channel, iwasku, COALESCE(fulfillment_channel, ''));

CREATE INDEX IF NOT EXISTS idx_sales_data_fulfillment
  ON sales_data (fulfillment_channel) WHERE fulfillment_channel IS NOT NULL;

-- Yetkiler korunsun (pricelab_db'de StockPulse okuma user'ı yok, doğrudan pricelab_user okuyor)

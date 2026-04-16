-- sku_master: denormalize edilmis urun kolonlarini kaldir
-- Bu kolonlar artik JOIN ile products tablosundan gelecek (sm.iwasku = p.product_sku)
-- Etkilenen app'ler: AmzSellMetrics, DataBridge, ManuMaestro, AdPilot — sorgulari guncellendi

ALTER TABLE sku_master DROP COLUMN IF EXISTS name;
ALTER TABLE sku_master DROP COLUMN IF EXISTS parent;
ALTER TABLE sku_master DROP COLUMN IF EXISTS category;
ALTER TABLE sku_master DROP COLUMN IF EXISTS cost;
ALTER TABLE sku_master DROP COLUMN IF EXISTS size;

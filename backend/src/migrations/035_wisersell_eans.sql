-- Migration 035: Wisersell EAN/barcode ingest
-- Wisersell /product/search yaniti artik top-level `eans` (dizi) donuyor (2026-06 guncellemesi).
-- Onceki sync bu alani okumuyordu; burada yakalamak icin kolon ekleniyor.
-- Bir SKU'nun birden fazla EAN'i olabilir → dizi olarak sakla (arr_sku ile ayni desen).

ALTER TABLE wisersell_products
  ADD COLUMN IF NOT EXISTS eans JSONB;

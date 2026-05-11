-- 029_fedex_dimensions.sql
-- FedEx Track API raw_response içindeki paket ebatlarını ayrı kolonlara çek.
-- FedEx fatura chargeable weight = max(weight_kg, dim_weight_kg).
-- dim_weight_kg = (L × W × H) / 5000 (FedEx CM divisor).

ALTER TABLE fedex_shipments
  ADD COLUMN IF NOT EXISTS length_cm     NUMERIC,
  ADD COLUMN IF NOT EXISTS width_cm      NUMERIC,
  ADD COLUMN IF NOT EXISTS height_cm     NUMERIC,
  ADD COLUMN IF NOT EXISTS dim_weight_kg NUMERIC;

-- Backfill: raw_response.**.dimensions[?(@.units=='CM')] içinden ilk match'i al.
-- jsonb_path_query_first(LAX mod) ile path traversal — birden fazla paketten
-- ilki yazılır (FedEx generally tek paket için boyut döner; çoklu paket
-- daha sonra ele alınır gerekirse).
UPDATE fedex_shipments
SET length_cm = (dim->>'length')::numeric,
    width_cm  = (dim->>'width')::numeric,
    height_cm = (dim->>'height')::numeric
FROM (
  SELECT tracking_number,
         jsonb_path_query_first(raw_response, '$.**.dimensions[*] ? (@.units == "CM")') AS dim
  FROM fedex_shipments
  WHERE raw_response IS NOT NULL
) d
WHERE fedex_shipments.tracking_number = d.tracking_number
  AND d.dim IS NOT NULL;

-- dim_weight_kg = L × W × H / 5000, 2 ondalık
UPDATE fedex_shipments
SET dim_weight_kg = ROUND(((length_cm * width_cm * height_cm) / 5000.0)::numeric, 2)
WHERE length_cm IS NOT NULL
  AND width_cm IS NOT NULL
  AND height_cm IS NOT NULL;

-- schema_migrations kaydı (varsa)
INSERT INTO schema_migrations (filename, applied_at)
SELECT '029_fedex_dimensions.sql', NOW()
WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE filename = '029_fedex_dimensions.sql');

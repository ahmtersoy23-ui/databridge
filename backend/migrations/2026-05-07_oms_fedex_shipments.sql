-- OMS (Wisersell) shipment manifest + FedEx Track API tarafından çekilen detay
-- Run: ssh -p 2222 root@78.47.117.36 \
--   "sudo -u postgres psql -d databridge_db -f /tmp/2026-05-07_oms_fedex_shipments.sql"

-- 1) OMS shipment manifest (Wisersell Excel upload)
CREATE TABLE IF NOT EXISTS oms_shipments (
  tracking_number     TEXT PRIMARY KEY,
  carrier             TEXT NOT NULL,         -- "FEDEX IWA", "Sürat Kargo", ...
  store               TEXT,                  -- "Etsy MA", "Ama_CITI", ...
  order_id            TEXT,                  -- SIPARIS NO
  label_no            TEXT,                  -- LABEL NO (ileride fatura match için)
  order_date          DATE,                  -- SIPARIS TARIHI
  ship_date           DATE,                  -- GONDERIM TARIHI
  recipient_country   TEXT,                  -- ALICI ULKE (Wisersell normalize edilmemiş)
  raw_row             JSONB,                 -- diğer tüm Excel kolonları (weight, adres, fatura no, vb.)
  source_file         TEXT,                  -- import sırasında dosya adı
  uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fedex_synced_at     TIMESTAMPTZ            -- Track API'ya en son ne zaman sorduk (NULL = hiç)
);

CREATE INDEX IF NOT EXISTS idx_oms_pending_fedex
  ON oms_shipments (carrier, fedex_synced_at)
  WHERE carrier = 'FEDEX IWA';

CREATE INDEX IF NOT EXISTS idx_oms_carrier_date
  ON oms_shipments (carrier, ship_date);

CREATE INDEX IF NOT EXISTS idx_oms_country
  ON oms_shipments (recipient_country);

-- 2) FedEx Track API yanıtı (per tracking number)
CREATE TABLE IF NOT EXISTS fedex_shipments (
  tracking_number     TEXT PRIMARY KEY,
  service_type        TEXT,                  -- "INTERNATIONAL_PRIORITY" vb.
  service_description TEXT,
  ship_timestamp      TIMESTAMPTZ,           -- pickup
  delivered_timestamp TIMESTAMPTZ,           -- gerçek teslim
  estimated_delivery  TIMESTAMPTZ,           -- FedEx commitment
  origin_country      TEXT,
  origin_city         TEXT,
  origin_postal       TEXT,
  dest_country        TEXT,
  dest_state          TEXT,
  dest_city           TEXT,
  dest_postal         TEXT,
  weight_kg           NUMERIC(8,2),
  package_count       INTEGER,
  latest_status_code  TEXT,                  -- DL=Delivered, IT=In Transit, OD=Out for Delivery, EX=Exception, ...
  latest_status_desc  TEXT,
  scan_events         JSONB,                 -- tüm scan event'leri (array): timestamp, code, description, location
  raw_response        JSONB,                 -- audit/future-proof
  not_found           BOOLEAN NOT NULL DEFAULT FALSE, -- API "no track data" döndürdüyse (eski 90+ gün)
  fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fedex_ship_ts
  ON fedex_shipments (ship_timestamp);

CREATE INDEX IF NOT EXISTS idx_fedex_dest
  ON fedex_shipments (dest_country, dest_postal);

CREATE INDEX IF NOT EXISTS idx_fedex_status_open
  ON fedex_shipments (latest_status_code, fetched_at)
  WHERE latest_status_code IS DISTINCT FROM 'DL' AND not_found = FALSE;

-- 3) Transit time analitiği için view (TR origin filtresi yok — tümü)
CREATE OR REPLACE VIEW v_fedex_transit_summary AS
SELECT
  COALESCE(o.recipient_country, f.dest_country)         AS dest_country,
  f.service_type,
  COUNT(*)                                              AS shipments,
  ROUND(AVG(EXTRACT(EPOCH FROM (f.delivered_timestamp - f.ship_timestamp)) / 86400)::numeric, 2) AS avg_days,
  ROUND(PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (f.delivered_timestamp - f.ship_timestamp)) / 86400)::numeric, 2) AS p50_days,
  ROUND(PERCENTILE_CONT(0.9)  WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (f.delivered_timestamp - f.ship_timestamp)) / 86400)::numeric, 2) AS p90_days,
  MIN(f.ship_timestamp)::date                           AS first_ship_date,
  MAX(f.ship_timestamp)::date                           AS last_ship_date
FROM fedex_shipments f
LEFT JOIN oms_shipments o ON o.tracking_number = f.tracking_number
WHERE f.delivered_timestamp IS NOT NULL
  AND f.ship_timestamp IS NOT NULL
GROUP BY 1, 2;

-- 4) Reconciliation view (CargoLens'in 2. katmanda tüketeceği): OMS + FedEx birleşik
CREATE OR REPLACE VIEW v_oms_fedex_join AS
SELECT
  o.tracking_number,
  o.carrier,
  o.store,
  o.order_id,
  o.label_no,
  o.ship_date                                           AS oms_ship_date,
  o.recipient_country                                   AS oms_country,
  f.dest_country                                        AS fedex_dest_country,
  f.service_type,
  f.ship_timestamp,
  f.delivered_timestamp,
  f.estimated_delivery,
  f.weight_kg,
  f.latest_status_code,
  f.latest_status_desc,
  f.not_found                                           AS fedex_not_found,
  CASE
    WHEN f.tracking_number IS NULL THEN 'oms_only'         -- Wisersell var, FedEx Track çağrılmamış
    WHEN f.not_found                THEN 'fedex_not_found' -- Track API tracking bulamadı (eski/iptal)
    WHEN f.latest_status_code = 'DL' THEN 'delivered'
    ELSE 'in_progress'
  END                                                   AS reconciliation_status
FROM oms_shipments o
LEFT JOIN fedex_shipments f ON f.tracking_number = o.tracking_number
WHERE o.carrier = 'FEDEX IWA';

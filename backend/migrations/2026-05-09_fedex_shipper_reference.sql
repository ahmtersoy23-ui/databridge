-- FedEx Track API'de SHIPPER_REFERENCE alanı (additionalTrackingInfo.packageIdentifiers)
-- Bizim TR ihracatlarda "ETGB" değeri taşıyor. Orphan tracking'leri için ETGB var/yok
-- bizim FedEx anlaşmamız üzerinden çıkıp çıkmadığının primary signal'i.
--
-- Run: ssh -p 2222 root@78.47.117.36 \
--   "sudo -u postgres psql -d databridge_db -f /tmp/2026-05-09_fedex_shipper_reference.sql"

ALTER TABLE fedex_shipments
  ADD COLUMN IF NOT EXISTS shipper_reference TEXT;

CREATE INDEX IF NOT EXISTS idx_fedex_shipref
  ON fedex_shipments (shipper_reference);

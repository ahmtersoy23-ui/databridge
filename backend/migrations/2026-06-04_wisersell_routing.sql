-- Wisersell ↔ ManuMaestro iki yönlü sipariş yönlendirme otomasyonu.
-- Run: ssh -p 2222 root@78.47.117.36 \
--   "sudo -u postgres psql -d databridge_db -f /tmp/2026-06-04_wisersell_routing.sql"
--
-- İki tablo:
--   wisersell_routing_candidates — sık poll (GET /api/orders, açık=2, US store) ile dolan
--     aday siparişler. ManuMaestro (queryDataBridge) okur, stok teyidi + onay yapar.
--   wisersell_store_map — storeId → US allowlist + marketplaceCode + label prefix config.
--
-- Akış: poll → iwasku çöz → candidates upsert. ManuMaestro onayda OutboundOrder oluşturur
-- + DataBridge /wisersell-routing/mark-ready çağırır (Kargoya Hazır=11). Kargo tracking
-- yüklenince /wisersell-routing/close (external-close) çağrılır.

-- ── Store allowlist + mapping ────────────────────────────────────────────────
-- region: ülke-genişletilebilir allowlist. NULL = kapsam dışı (otomasyona girmez).
-- Şimdi yalnız 'US' bağlı; ileride 'UK'/'EU' eklenince yeni satır yeter (migration/redesign yok).
CREATE TABLE IF NOT EXISTS wisersell_store_map (
  store_id         INTEGER PRIMARY KEY,        -- GET /orders rows[].storeId
  region           TEXT,                       -- 'US' | 'UK' | 'EU' | ... | NULL (kapsam dışı)
  marketplace_code TEXT,                       -- ManuMaestro outbound_orders.marketplaceCode (CUSTOM_07 vb)
  label_prefix     TEXT,                       -- label base = prefix + labelNo (S_IWAUS vb)
  notes            TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed: gözlemlenen storeId'ler (2026-06-04). region NULL olanlar otomasyona girmez.
-- Allowlist'i burada genişlet. Amazon (102) US/diğer ayrımı için poll country_id/order_code
-- prefix'i de kontrol eder (build-time doğrulanacak) — şimdilik US Shopify (149) doğrulanmış tek US kanalı.
INSERT INTO wisersell_store_map (store_id, region, marketplace_code, label_prefix, notes) VALUES
  (149, 'US', 'CUSTOM_07', 'S_IWAUS', 'US Shopify (iwa) — doğrulanmış US kanalı'),
  (102, NULL, NULL,        NULL,      'Amazon (çok ülkeli) — US ayrımı netleşince region=US + country kuralı'),
  (142, NULL, NULL,        NULL,      'Trendyol Express (TR) — kapsam dışı'),
  (153, NULL, NULL,        NULL,      'TR Shopify (colorfullworlds) — kapsam dışı')
ON CONFLICT (store_id) DO NOTHING;

-- ── Aday siparişler (poll dolduruyor, upsert on wisersell_order_id) ──────────
CREATE TABLE IF NOT EXISTS wisersell_routing_candidates (
  wisersell_order_id  BIGINT PRIMARY KEY,       -- GET /orders rows[].id — status/update + external-close anahtarı
  order_code          TEXT NOT NULL,            -- rows[].order_code = ManuMaestro orderNumber
  store_id            INTEGER,
  country_id          INTEGER,
  currency_id         INTEGER,
  orderstatus_id      INTEGER,                  -- 2=Açık, 11=Kargoya Hazır
  recipient_name      TEXT,                     -- rows[].name / customer.name
  label_no            TEXT,                     -- rows[].labelNo
  ws_shipment_date    BIGINT,                   -- rows[].shipment_date (epoch sn)
  created_at_ws       TIMESTAMPTZ,              -- rows[].created_at
  orderitems          JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- [{iwasku, qty, product_code, marketplace_sku, product_name, resolved_by}]
  region              TEXT,                     -- store_map.region ('US' ...) — kapsam dışıysa bu tabloya hiç yazılmaz
  raw_row             JSONB,                    -- tam order objesi (debug)
  first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  gone_at             TIMESTAMPTZ               -- açık statüden çıkınca (artık poll'da görünmüyor) işaretlenir
);

-- Tam teslim adresi (GET /api/orders/{id} detayından; liste JSON'da yok). Lazy doldurulur.
ALTER TABLE wisersell_routing_candidates ADD COLUMN IF NOT EXISTS ship_address TEXT;

CREATE INDEX IF NOT EXISTS idx_wrc_region_active ON wisersell_routing_candidates (region) WHERE gone_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_wrc_order_code ON wisersell_routing_candidates (order_code);
CREATE INDEX IF NOT EXISTS idx_wrc_store ON wisersell_routing_candidates (store_id);
CREATE INDEX IF NOT EXISTS idx_wrc_status ON wisersell_routing_candidates (orderstatus_id);

-- ── ManuMaestro okuma yetkisi ────────────────────────────────────────────────
-- ManuMaestro queryDataBridge (DATABRIDGE_DB_URL) databridge_db'ye manumaestro_user ile bağlanır
-- (sunucu .env, 2026-06-04 doğrulandı).
GRANT SELECT ON wisersell_routing_candidates TO manumaestro_user;
GRANT SELECT ON wisersell_store_map TO manumaestro_user;

-- Wisersell bekleyen siparişler — günlük snapshot tablosu.
-- Run: ssh -p 2222 root@78.47.117.36 \
--   "sudo -u postgres psql -d databridge_db -f /tmp/2026-05-12_wisersell_pending_orders.sql"
--
-- Iki status grubu:
--   'open'          = /ws/order/open       (yeni gelen, henüz işleme alınmamış)
--   'ready_to_ship' = /ws/order/waiting    (kargoya hazır, sevkiyat bekliyor)
-- Kapalı + Teslim siparişler ayrı tabloda (wisersell_orders) tutuluyor.
--
-- Snapshot stratejisi: her gün tam çekim, snapshot_date kolonu ile sürüm.
-- Retention 30 gün — stok istatistiği için trend yeterli, eski snapshot'lar silinir.

CREATE TABLE IF NOT EXISTS wisersell_pending_orders (
  id                   SERIAL PRIMARY KEY,
  snapshot_date        DATE NOT NULL,
  status               TEXT NOT NULL,            -- 'open' | 'ready_to_ship'
  effective_status     TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'stale'
  stale_age_days       INTEGER,                  -- bugün - siparis_tarihi

  siparis_no           TEXT NOT NULL,
  etiket_no            TEXT,
  label_base           TEXT,
  platform             TEXT,
  siparis_tarihi       DATE,
  gonderim_tarihi      DATE,
  kalan_gun            TEXT,                     -- Excel'deki "KALAN GUN" — hem int hem "Süre N gün geçti" olabilir
  alici_adi            TEXT,
  email                TEXT,
  adres                TEXT,
  ulke                 TEXT,
  urun_id              TEXT,
  urun_kodu            TEXT,
  sku                  TEXT,
  urun_basligi         TEXT,
  urun_adi             TEXT,
  varyant              TEXT,
  adet                 INTEGER,
  musteri_notu         TEXT,
  raw_row              JSONB,
  captured_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique: bir snapshot_date içinde her (status × sipariş × sku × varyant) tek satır
CREATE UNIQUE INDEX IF NOT EXISTS uq_wpo_snapshot
  ON wisersell_pending_orders (snapshot_date, status, siparis_no, sku, COALESCE(varyant, ''));

CREATE INDEX IF NOT EXISTS idx_wpo_snapshot_date ON wisersell_pending_orders (snapshot_date);
CREATE INDEX IF NOT EXISTS idx_wpo_status ON wisersell_pending_orders (status);
CREATE INDEX IF NOT EXISTS idx_wpo_effective ON wisersell_pending_orders (effective_status);
CREATE INDEX IF NOT EXISTS idx_wpo_platform ON wisersell_pending_orders (platform);
CREATE INDEX IF NOT EXISTS idx_wpo_siparis ON wisersell_pending_orders (siparis_no);
CREATE INDEX IF NOT EXISTS idx_wpo_etiket ON wisersell_pending_orders (etiket_no);
CREATE INDEX IF NOT EXISTS idx_wpo_sku ON wisersell_pending_orders (sku);
CREATE INDEX IF NOT EXISTS idx_wpo_gonderim ON wisersell_pending_orders (gonderim_tarihi);

-- En son snapshot'a hızlı erişim için kompozit indeks
CREATE INDEX IF NOT EXISTS idx_wpo_latest ON wisersell_pending_orders (snapshot_date DESC, status, effective_status);

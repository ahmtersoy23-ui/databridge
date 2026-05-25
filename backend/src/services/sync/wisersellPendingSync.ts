import * as XLSX from 'xlsx';
import { pool } from '../../config/database';
import logger from '../../config/logger';
import { downloadOrdersExcel } from '../wisersell/webClient';
import {
  WISERSELL_STATUS_CODES,
  WISERSELL_AMAZON_PLATFORMS_DUPLICATE,
  WISERSELL_AMAZON_PLATFORMS_KEEP,
  getWisersellPendingRetentionDays,
  getWisersellPendingStaleAgeDays,
} from '../../config/constants';

/**
 * Wisersell bekleyen sipariş sync (open + ready_to_ship).
 *
 * Akış:
 *   1. /api/excel/order → status:[2,6] = open
 *   2. /api/excel/order → status:[11]  = ready_to_ship
 *   3. Parse → Amazon dup filtre → effective_status hesapla → snapshot insert
 *   4. Post-cleanup: wisersell_orders'a düşmüş kayıtları sil (closed'a geçenler)
 *   5. Retention: 30 günden eski snapshot'ları sil
 *
 * Idempotent: aynı gün tekrar çalışırsa o günün snapshot'unu temizleyip yeniden yazar.
 */

export type PendingStatus = 'open' | 'ready_to_ship';

const HEADER_ALIASES: Record<string, string[]> = {
  siparis_no:      ['SIPARIS NO', 'SİPARİŞ NO'],
  etiket_no:       ['ETIKET NO', 'ETİKET NO'],
  urun_basligi:    ['URUN BAŞLIĞI', 'ÜRÜN BAŞLIĞI'],
  urun_adi:        ['URUN ADI', 'ÜRÜN ADI'],
  platform:        ['PLATFORM'],
  siparis_tarihi:  ['SIPARIS TARIHI', 'SİPARİŞ TARİHİ'],
  gonderim_tarihi: ['GONDERIM TARIHI', 'GÖNDERİM TARİHİ'],
  kalan_gun:       ['KALAN GUN', 'KALAN GÜN'],
  alici_adi:       ['ALICI ADI'],
  email:           ['E-MAIL', 'E-MAİL', 'EMAIL'],
  adres:           ['ADRES'],
  ulke:            ['ÜLKE', 'ULKE'],
  urun_id:         ['URUN ID', 'ÜRÜN ID'],
  urun_kodu:       ['URUN KODU', 'ÜRÜN KODU'],
  sku:             ['SKU'],
  varyant:         ['VARYANT'],
  adet:            ['ADET'],
  musteri_notu:    ['MUSTERI NOTU', 'MÜŞTERİ NOTU'],
};

function getCell(row: Record<string, unknown>, key: keyof typeof HEADER_ALIASES): unknown {
  for (const alias of HEADER_ALIASES[key]) {
    if (alias in row) return row[alias];
  }
  return null;
}

function clean(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s === '-' || s === ' - ') return null;
  return s;
}

function parseDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === 'string') {
    const s = v.trim();
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const [, dd, mm, yyyy] = m;
      return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  }
  return null;
}

function parseInt0(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function deriveLabelBase(etiketNo: string | null): string | null {
  if (!etiketNo) return null;
  const idx = etiketNo.indexOf('-');
  return idx > 0 ? etiketNo.slice(0, idx) : etiketNo;
}

/**
 * Amazon kanal filtresi. Wisersell'in `Ama_*` / `AMA_*` / `Amazon_*` platformları
 * sales_data'da zaten var (US/CA/UK/DE/FR/IT/ES/AU/AE/SA + EU "others" aggregate).
 * Sadece sales_data'da OLMAYAN iki Amazon kanalı (Ama_CITI = ayrı seller hesabı,
 * Ama_SGP = SP-API kapsamı dışı Singapore) pending'e dahil edilir.
 */
export function shouldSkipForAmazonDuplicate(platform: string | null): boolean {
  if (!platform) return false;
  if (WISERSELL_AMAZON_PLATFORMS_KEEP.has(platform)) return false;
  return WISERSELL_AMAZON_PLATFORMS_DUPLICATE.has(platform);
}

export function computeEffectiveStatus(
  status: PendingStatus,
  siparisTarihi: string | null,
  today: Date,
): { effective_status: 'active' | 'stale'; stale_age_days: number | null } {
  if (!siparisTarihi) return { effective_status: 'active', stale_age_days: null };
  const dt = new Date(siparisTarihi + 'T00:00:00Z');
  if (isNaN(dt.getTime())) return { effective_status: 'active', stale_age_days: null };
  const days = Math.floor((today.getTime() - dt.getTime()) / 86_400_000);
  // Sadece ready_to_ship'i stale işaretle — etiketi basılmış ama sevkiyat olmamış,
  // operasyonel kapanmamış demek. Open'da eski sipariş = farklı durum (müşteri
  // onayı bekleniyor olabilir), ayrı incelenmesi gerek.
  const isStale = status === 'ready_to_ship' && days > getWisersellPendingStaleAgeDays();
  return { effective_status: isStale ? 'stale' : 'active', stale_age_days: days };
}

export interface PendingSyncSummary {
  status: PendingStatus;
  fetched: number;
  skipped_amazon: number;
  inserted: number;
  active: number;
  stale: number;
}

export interface PendingSyncOptions {
  /** Lokal dosya yolu — verilirse API çağrısı atlanır (test/manual import için) */
  filePath?: string;
  /** Snapshot date override (test için). Default = bugün UTC */
  snapshotDate?: string;
}

const INSERT_COLS = [
  'snapshot_date', 'status', 'effective_status', 'stale_age_days',
  'siparis_no', 'etiket_no', 'label_base', 'platform',
  'siparis_tarihi', 'gonderim_tarihi', 'kalan_gun',
  'alici_adi', 'email', 'adres', 'ulke',
  'urun_id', 'urun_kodu', 'sku', 'urun_basligi', 'urun_adi', 'varyant',
  'adet', 'musteri_notu', 'raw_row',
] as const;

const COL_COUNT = INSERT_COLS.length; // 24

/**
 * Tek bir status grubunu çek + parse + insert.
 * DELETE-then-INSERT mantığıyla idempotent: aynı gün re-run çalışır.
 */
export async function syncPendingForStatus(
  status: PendingStatus,
  opts: PendingSyncOptions = {},
): Promise<PendingSyncSummary> {
  const snapshotDate = opts.snapshotDate ?? new Date().toISOString().slice(0, 10);
  const summary: PendingSyncSummary = {
    status,
    fetched: 0,
    skipped_amazon: 0,
    inserted: 0,
    active: 0,
    stale: 0,
  };

  // 1. Excel'i indir veya lokal'den oku
  let buf: Buffer;
  if (opts.filePath) {
    const fs = await import('fs');
    buf = fs.readFileSync(opts.filePath);
    logger.info(`[WisersellPendingSync] [${status}] Lokal dosya: ${opts.filePath} (${(buf.length / 1024).toFixed(1)} KB)`);
  } else {
    const statusCodes = WISERSELL_STATUS_CODES[status];
    logger.info(`[WisersellPendingSync] [${status}] Excel indiriliyor (status=[${statusCodes.join(',')}])...`);
    buf = await downloadOrdersExcel({ status: statusCodes });
    logger.info(`[WisersellPendingSync] [${status}] Excel indirildi (${(buf.length / 1024).toFixed(1)} KB)`);
  }

  // 2. Parse
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: false });
  summary.fetched = rows.length;
  logger.info(`[WisersellPendingSync] [${status}] ${rows.length} satır parse edildi`);

  const today = new Date(snapshotDate + 'T00:00:00Z');

  type Parsed = {
    siparis_no: string;
    etiket_no: string | null;
    label_base: string | null;
    platform: string | null;
    siparis_tarihi: string | null;
    gonderim_tarihi: string | null;
    kalan_gun: string | null;
    alici_adi: string | null;
    email: string | null;
    adres: string | null;
    ulke: string | null;
    urun_id: string | null;
    urun_kodu: string | null;
    sku: string | null;
    urun_basligi: string | null;
    urun_adi: string | null;
    varyant: string | null;
    adet: number | null;
    musteri_notu: string | null;
    effective_status: 'active' | 'stale';
    stale_age_days: number | null;
    raw_row: unknown;
  };

  const parsed: Parsed[] = [];
  for (const row of rows) {
    const siparis_no = clean(getCell(row, 'siparis_no'));
    const sku = clean(getCell(row, 'sku')) || clean(getCell(row, 'urun_kodu'));
    if (!siparis_no || !sku) continue;

    const platform = clean(getCell(row, 'platform'));
    if (shouldSkipForAmazonDuplicate(platform)) {
      summary.skipped_amazon++;
      continue;
    }

    const etiket_no = clean(getCell(row, 'etiket_no'));
    const siparis_tarihi = parseDate(getCell(row, 'siparis_tarihi'));
    const eff = computeEffectiveStatus(status, siparis_tarihi, today);

    parsed.push({
      siparis_no,
      etiket_no,
      label_base: deriveLabelBase(etiket_no),
      platform,
      siparis_tarihi,
      gonderim_tarihi: parseDate(getCell(row, 'gonderim_tarihi')),
      kalan_gun: clean(getCell(row, 'kalan_gun')),
      alici_adi: clean(getCell(row, 'alici_adi')),
      email: clean(getCell(row, 'email')),
      adres: clean(getCell(row, 'adres')),
      ulke: clean(getCell(row, 'ulke')),
      urun_id: clean(getCell(row, 'urun_id')),
      urun_kodu: clean(getCell(row, 'urun_kodu')),
      sku,
      urun_basligi: clean(getCell(row, 'urun_basligi')),
      urun_adi: clean(getCell(row, 'urun_adi')),
      varyant: clean(getCell(row, 'varyant')),
      adet: parseInt0(getCell(row, 'adet')),
      musteri_notu: clean(getCell(row, 'musteri_notu')),
      effective_status: eff.effective_status,
      stale_age_days: eff.stale_age_days,
      raw_row: row,
    });
  }

  // Pre-dedupe: snapshot içinde (siparis_no × sku × varyant) tek satır
  const dedupeMap = new Map<string, Parsed>();
  for (const p of parsed) {
    const key = `${p.siparis_no}|${p.sku}|${p.varyant ?? ''}`;
    dedupeMap.set(key, p);
  }
  const deduped = [...dedupeMap.values()];
  if (deduped.length < parsed.length) {
    logger.info(`[WisersellPendingSync] [${status}] Dedupe: ${parsed.length} → ${deduped.length}`);
  }

  // 3. Transaction: delete this snapshot+status → insert
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      'DELETE FROM wisersell_pending_orders WHERE snapshot_date = $1 AND status = $2',
      [snapshotDate, status],
    );

    const BATCH = 300; // 300 × 24 = 7200 params, PostgreSQL limit 65535
    for (let i = 0; i < deduped.length; i += BATCH) {
      const slice = deduped.slice(i, i + BATCH);
      const values: string[] = [];
      const params: unknown[] = [];
      slice.forEach((p, idx) => {
        const offset = idx * COL_COUNT;
        const placeholders = Array.from({ length: COL_COUNT }, (_, k) => `$${offset + k + 1}`);
        placeholders[COL_COUNT - 1] = `${placeholders[COL_COUNT - 1]}::jsonb`; // raw_row
        values.push(`(${placeholders.join(',')})`);
        params.push(
          snapshotDate, status, p.effective_status, p.stale_age_days,
          p.siparis_no, p.etiket_no, p.label_base, p.platform,
          p.siparis_tarihi, p.gonderim_tarihi, p.kalan_gun,
          p.alici_adi, p.email, p.adres, p.ulke,
          p.urun_id, p.urun_kodu, p.sku, p.urun_basligi, p.urun_adi, p.varyant,
          p.adet, p.musteri_notu,
          JSON.stringify(p.raw_row).replace(/ /g, ''),
        );
      });

      if (values.length > 0) {
        await client.query(
          `INSERT INTO wisersell_pending_orders (${INSERT_COLS.join(', ')})
           VALUES ${values.join(',')}`,
          params,
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  summary.inserted = deduped.length;
  summary.active = deduped.filter(p => p.effective_status === 'active').length;
  summary.stale = deduped.filter(p => p.effective_status === 'stale').length;

  logger.info(
    `[WisersellPendingSync] [${status}] Bitti: ${summary.inserted} insert ` +
    `(${summary.active} active, ${summary.stale} stale, ${summary.skipped_amazon} Amazon-skip)`,
  );
  return summary;
}

export interface FullPendingSyncResult {
  open: PendingSyncSummary;
  ready_to_ship: PendingSyncSummary;
  closed_overlap_removed: number;
  old_snapshots_removed: number;
}

/**
 * Tam pending sync: open + ready_to_ship + post-cleanup + retention.
 * Closed sync'in 15 dk arkasından scheduler tarafından çağrılır.
 */
export async function syncWisersellPendingOrders(
  opts: PendingSyncOptions = {},
): Promise<FullPendingSyncResult> {
  const snapshotDate = opts.snapshotDate ?? new Date().toISOString().slice(0, 10);

  // 1. Open
  const open = await syncPendingForStatus('open', opts);
  // 2. Ready to ship
  const ready = await syncPendingForStatus('ready_to_ship', opts);

  // 3. Post-cleanup: bir sipariş bu snapshot'ta hem pending hem de wisersell_orders'ta
  // (closed) varsa pending'ten sil — closed sync mevcut, hayalet kayıt kalmasın.
  const cleanupRes = await pool.query(
    `DELETE FROM wisersell_pending_orders p
       USING wisersell_orders o
     WHERE p.snapshot_date = $1
       AND p.siparis_no = o.siparis_no
       AND p.sku = o.sku
       AND COALESCE(p.varyant, '') = COALESCE(o.varyant, '')`,
    [snapshotDate],
  );
  const closed_overlap_removed = cleanupRes.rowCount ?? 0;
  if (closed_overlap_removed > 0) {
    logger.info(`[WisersellPendingSync] Post-cleanup: ${closed_overlap_removed} closed-overlap satırı silindi`);
  }

  // 4. Retention: eski snapshot'ları sil (default 30 gün, env ile override)
  const retentionDays = getWisersellPendingRetentionDays();
  const retentionRes = await pool.query(
    `DELETE FROM wisersell_pending_orders
     WHERE snapshot_date < CURRENT_DATE - ($1 || ' days')::interval`,
    [String(retentionDays)],
  );
  const old_snapshots_removed = retentionRes.rowCount ?? 0;
  if (old_snapshots_removed > 0) {
    logger.info(`[WisersellPendingSync] Retention: ${old_snapshots_removed} eski snapshot satırı silindi (>${retentionDays} gün)`);
  }

  return { open, ready_to_ship: ready, closed_overlap_removed, old_snapshots_removed };
}

import * as XLSX from 'xlsx';
import { errMessage } from '../../utils/errors';
import { pool } from '../../config/database';
import logger from '../../config/logger';
import { downloadOrdersExcel } from '../wisersell/webClient';
import { resolveBatch } from '../wisersell/iwaskuResolver';

/**
 * Wisersell Kapalı Sipariş raporu sync.
 *
 * Akış:
 *   1. /api/excel/order çağır (status:[5,8] = Kapalı + Teslim)
 *   2. Excel parse → her satır bir line item (sipariş × SKU × varyant)
 *   3. wisersell_orders tablosuna upsert (composite unique:
 *      siparis_no + sku + COALESCE(varyant,''))
 *
 * Eşleşme: ETIKET NO "S_IWAUS21462-1/1" → label_base "S_IWAUS21462"
 * → oms_shipments.label_no üzerinden tracking_number'a ulaşılır.
 */

const HEADER_ALIASES: Record<string, string[]> = {
  siparis_no:           ['SIPARIS NO', 'SİPARİŞ NO'],
  etiket_no:            ['ETIKET NO', 'ETİKET NO'],
  urun_basligi:         ['URUN BAŞLIĞI', 'ÜRÜN BAŞLIĞI'],
  urun_adi:             ['URUN ADI', 'ÜRÜN ADI'],
  platform:             ['PLATFORM'],
  siparis_tarihi:       ['SIPARIS TARIHI', 'SİPARİŞ TARİHİ'],
  gonderim_tarihi:      ['GONDERIM TARIHI', 'GÖNDERİM TARİHİ'],
  alici_adi:            ['ALICI ADI'],
  email:                ['E-MAIL', 'E-MAİL', 'EMAIL'],
  adres:                ['ADRES'],
  ulke:                 ['ÜLKE', 'ULKE'],
  urun_id:              ['URUN ID', 'ÜRÜN ID'],
  urun_kodu:            ['URUN KODU', 'ÜRÜN KODU'],
  sku:                  ['SKU'],
  varyant:              ['VARYANT'],
  adet:                 ['ADET'],
  musteri_notu:         ['MUSTERI NOTU', 'MÜŞTERİ NOTU'],
  urun_aciklamalari:    ['URUN ACIKLAMALARI', 'ÜRÜN AÇIKLAMALARI'],
  hediye_notu:          ['HEDİYE NOTU', 'HEDIYE NOTU'],
  kullanici_notu:       ['KULLANICI NOTU', 'KULLANICI NOTU '],
  kisisellestirme_notu: ['KİŞİSELLEŞTİRME NOTU', 'KISISELLESTIRME NOTU'],
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
  // "S_IWAUS21462-1/1" → "S_IWAUS21462"
  const idx = etiketNo.indexOf('-');
  return idx > 0 ? etiketNo.slice(0, idx) : etiketNo;
}

export interface OrderSyncResult {
  parsed: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  fetchedRows?: number;
}

export interface OrderSyncOptions {
  shipmentDateFrom?: string; // ISO datetime
  shipmentDateTo?: string;
  /** Mode: 'append' (default) → upsert; 'window_replace' → DELETE WHERE shipment_date >= from + INSERT */
  mode?: 'append' | 'window_replace';
  status?: number[];
  /** Lokal dosya yolu — verilirse API çağrısı atlanır (manuel indirme bypass) */
  filePath?: string;
}

export async function syncWisersellOrders(opts: OrderSyncOptions = {}): Promise<OrderSyncResult> {
  const result: OrderSyncResult = { parsed: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 };

  let buf: Buffer;
  if (opts.filePath) {
    const fs = await import('fs');
    buf = fs.readFileSync(opts.filePath);
    logger.info(`[WisersellOrderSync] Lokal dosya: ${opts.filePath} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
  } else {
    logger.info(`[WisersellOrderSync] Excel indiriliyor (from=${opts.shipmentDateFrom || 'all'})...`);
    buf = await downloadOrdersExcel({
      shipmentDateFrom: opts.shipmentDateFrom,
      shipmentDateTo: opts.shipmentDateTo,
      status: opts.status,
    });
    logger.info(`[WisersellOrderSync] Excel indirildi (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
  }

  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: false });
  result.fetchedRows = rows.length;
  logger.info(`[WisersellOrderSync] ${rows.length} satır parse edildi`);

  if (rows.length === 0) return result;

  const sourceFile = `wisersell-order-${new Date().toISOString().slice(0, 10)}.xlsx`;

  // Parse satırları
  type Parsed = {
    siparis_no: string;
    etiket_no: string | null;
    label_base: string | null;
    platform: string | null;
    siparis_tarihi: string | null;
    gonderim_tarihi: string | null;
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
    urun_aciklamalari: string | null;
    hediye_notu: string | null;
    kullanici_notu: string | null;
    kisisellestirme_notu: string | null;
    iwasku: string | null;
    resolved_by: string | null;
    raw_row: unknown;
  };
  const parsed: Parsed[] = [];
  for (const row of rows) {
    const siparis_no = clean(getCell(row, 'siparis_no'));
    const sku = clean(getCell(row, 'sku')) || clean(getCell(row, 'urun_kodu'));
    if (!siparis_no || !sku) {
      result.skipped++;
      continue;
    }
    const etiket_no = clean(getCell(row, 'etiket_no'));
    parsed.push({
      siparis_no,
      etiket_no,
      label_base: deriveLabelBase(etiket_no),
      platform: clean(getCell(row, 'platform')),
      siparis_tarihi: parseDate(getCell(row, 'siparis_tarihi')),
      gonderim_tarihi: parseDate(getCell(row, 'gonderim_tarihi')),
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
      urun_aciklamalari: clean(getCell(row, 'urun_aciklamalari')),
      hediye_notu: clean(getCell(row, 'hediye_notu')),
      kullanici_notu: clean(getCell(row, 'kullanici_notu')),
      kisisellestirme_notu: clean(getCell(row, 'kisisellestirme_notu')),
      iwasku: null,
      resolved_by: null,
      raw_row: row,
    });
  }

  // iwasku resolution — 4 katmanlı zincir (cache'li sözlüklerle batch)
  if (parsed.length > 0) {
    const resolutions = await resolveBatch(
      parsed.map(p => ({ urun_kodu: p.urun_kodu, sku: p.sku, urun_basligi: p.urun_basligi })),
    );
    parsed.forEach((p, idx) => {
      p.iwasku = resolutions[idx].iwasku;
      p.resolved_by = resolutions[idx].resolved_by;
    });
    const matched = resolutions.filter(r => r.iwasku).length;
    logger.info(`[WisersellOrderSync] iwasku resolution: ${matched}/${parsed.length} eşleşti`);
  }
  // Pre-dedupe: aynı (siparis_no, sku, varyant) için son satırı tut
  // (Wisersell Excel'de bazen aynı satır tekrarlanıyor — ON CONFLICT batch'i bozar)
  const dedupeMap = new Map<string, Parsed>();
  for (const p of parsed) {
    const key = `${p.siparis_no}|${p.sku}|${p.varyant ?? ''}`;
    dedupeMap.set(key, p);
  }
  const deduped = [...dedupeMap.values()];
  if (deduped.length < parsed.length) {
    logger.info(`[WisersellOrderSync] Dedupe: ${parsed.length} → ${deduped.length} (${parsed.length - deduped.length} duplicate)`);
  }
  parsed.length = 0;
  parsed.push(...deduped);
  result.parsed = parsed.length;

  // Window replace mode (daily 14-day cron için): önce eski pencereyi temizle
  if (opts.mode === 'window_replace' && opts.shipmentDateFrom) {
    const cutoff = opts.shipmentDateFrom.slice(0, 10);
    const del = await pool.query(
      'DELETE FROM wisersell_orders WHERE gonderim_tarihi >= $1::date',
      [cutoff],
    );
    logger.info(`[WisersellOrderSync] Window replace: ${del.rowCount} eski satır silindi (>= ${cutoff})`);
  }

  // Upsert (chunked)
  const BATCH = 500;
  for (let i = 0; i < parsed.length; i += BATCH) {
    const slice = parsed.slice(i, i + BATCH);
    const values: string[] = [];
    const params: unknown[] = [];
    slice.forEach((p, idx) => {
      const o = idx * 25;
      const placeholders = Array.from({ length: 25 }, (_, k) => `$${o + k + 1}`);
      placeholders[24] = `${placeholders[24]}::jsonb`; // raw_row son kolon
      values.push(`(${placeholders.join(',')})`);
      params.push(
        p.siparis_no, p.etiket_no, p.label_base, p.platform,
        p.siparis_tarihi, p.gonderim_tarihi,
        p.alici_adi, p.email, p.adres, p.ulke,
        p.urun_id, p.urun_kodu, p.sku, p.urun_basligi, p.urun_adi, p.varyant,
        p.adet, p.musteri_notu, p.urun_aciklamalari, p.hediye_notu,
        p.kullanici_notu, p.kisisellestirme_notu,
        p.iwasku, p.resolved_by,
        JSON.stringify(p.raw_row).replace(/ /g, ''),
      );
    });

    try {
      // ON CONFLICT için ifade-bazlı unique index target lazım
      const r = await pool.query<{ inserted: boolean }>(
        `INSERT INTO wisersell_orders (
           siparis_no, etiket_no, label_base, platform,
           siparis_tarihi, gonderim_tarihi,
           alici_adi, email, adres, ulke,
           urun_id, urun_kodu, sku, urun_basligi, urun_adi, varyant,
           adet, musteri_notu, urun_aciklamalari, hediye_notu,
           kullanici_notu, kisisellestirme_notu,
           iwasku, resolved_by,
           raw_row
         ) VALUES ${values.join(',')}
         ON CONFLICT (siparis_no, sku, COALESCE(varyant, '')) DO UPDATE SET
           etiket_no = EXCLUDED.etiket_no,
           label_base = EXCLUDED.label_base,
           platform = EXCLUDED.platform,
           siparis_tarihi = EXCLUDED.siparis_tarihi,
           gonderim_tarihi = EXCLUDED.gonderim_tarihi,
           alici_adi = EXCLUDED.alici_adi,
           email = EXCLUDED.email,
           adres = EXCLUDED.adres,
           ulke = EXCLUDED.ulke,
           urun_id = EXCLUDED.urun_id,
           urun_kodu = EXCLUDED.urun_kodu,
           urun_basligi = EXCLUDED.urun_basligi,
           urun_adi = EXCLUDED.urun_adi,
           adet = EXCLUDED.adet,
           musteri_notu = EXCLUDED.musteri_notu,
           urun_aciklamalari = EXCLUDED.urun_aciklamalari,
           hediye_notu = EXCLUDED.hediye_notu,
           kullanici_notu = EXCLUDED.kullanici_notu,
           kisisellestirme_notu = EXCLUDED.kisisellestirme_notu,
           iwasku = EXCLUDED.iwasku,
           resolved_by = EXCLUDED.resolved_by,
           raw_row = EXCLUDED.raw_row,
           synced_at = NOW()
         RETURNING (xmax = 0) AS inserted`,
        params,
      );
      for (const row of r.rows) {
        if (row.inserted) result.inserted++;
        else result.updated++;
      }
    } catch (err: unknown) {
      logger.error(`[WisersellOrderSync] batch ${i}/${parsed.length} hata: ${errMessage(err)}`);
      result.errors += slice.length;
    }
  }

  logger.info(
    `[WisersellOrderSync] Bitti: ${result.inserted} insert, ${result.updated} update, ` +
    `${result.skipped} skip, ${result.errors} err (toplam ${result.parsed} parse)`,
  );
  return result;
}

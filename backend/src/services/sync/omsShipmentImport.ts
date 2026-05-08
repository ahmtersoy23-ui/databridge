import * as XLSX from 'xlsx';
import { pool } from '../../config/database';
import logger from '../../config/logger';

/**
 * OMS shipment Excel parser + UPSERT helper.
 * Hem CLI script (importOmsShipments.ts) hem cron sync (wisersellShipmentSync.ts) kullanır.
 *
 * Beklenen Wisersell Excel kolon başlıkları:
 *   KARGO FIRMASI, MAGAZA, KARGO TAKIP NO, SIPARIS TARIHI, LABEL NO,
 *   SIPARIS NO, GONDERIM TARIHI, KAP ADEDI, BRUT KG, ALICI, ALICI ADRES,
 *   ALICI ULKE, MUSTERI, MUSTERI E-MAIL, MUSTERI ADRES, ...
 */

const HEADER_ALIASES: Record<string, string[]> = {
  carrier:   ['KARGO FIRMASI', 'KARGO FIRMASI '],
  store:     ['MAGAZA'],
  tracking:  ['KARGO TAKIP NO'],
  orderDate: ['SIPARIS TARIHI'],
  labelNo:   ['LABEL NO'],
  orderId:   ['SIPARIS NO'],
  shipDate:  ['GONDERIM TARIHI'],
  country:   ['ALICI ULKE'],
};

export function getCell(row: Record<string, unknown>, key: keyof typeof HEADER_ALIASES): unknown {
  for (const alias of HEADER_ALIASES[key]) {
    if (alias in row) return row[alias];
  }
  return null;
}

export function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s || s === '-') return null;
  return s;
}

export function parseDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '-') return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    const s = value.trim();
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const [, dd, mm, yyyy] = m;
      return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  }
  if (typeof value === 'number') {
    const parsed = (XLSX as any).SSF?.parse_date_code?.(value);
    if (parsed && parsed.y) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }
  return null;
}

export function splitTracking(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  const cleaned = String(value).replace(/\s+/g, '');
  if (!cleaned) return [];
  const parts = cleaned.split(/[,;]/).map(s => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const piece of parts) {
    if (/^\d+$/.test(piece) && piece.length >= 24 && piece.length % 12 === 0) {
      for (let i = 0; i < piece.length; i += 12) out.push(piece.slice(i, i + 12));
    } else {
      out.push(piece);
    }
  }
  return out;
}

export type ImportMode = 'upsert' | 'insert_only';

export interface ImportSummary {
  totalRows: number;
  inserted: number;
  updated: number;
  alreadyExists: number;
  skippedNoTracking: number;
  skippedNoCarrier: number;
  carrierCounts: Record<string, number>;
}

interface PreparedRow {
  tracking_number: string;
  carrier: string;
  store: string | null;
  order_id: string | null;
  label_no: string | null;
  order_date: string | null;
  ship_date: string | null;
  recipient_country: string | null;
  raw_row: Record<string, unknown>;
}

const BATCH_SIZE = 500;

async function flushBatch(
  batch: PreparedRow[],
  sourceFile: string,
  mode: ImportMode,
): Promise<{ inserted: number; updated: number; alreadyExists: number }> {
  if (batch.length === 0) return { inserted: 0, updated: 0, alreadyExists: 0 };
  const values: string[] = [];
  const params: unknown[] = [];
  batch.forEach((r, i) => {
    const o = i * 10;
    values.push(`($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6},$${o+7},$${o+8},$${o+9},$${o+10})`);
    params.push(
      r.tracking_number, r.carrier, r.store, r.order_id, r.label_no,
      r.order_date, r.ship_date, r.recipient_country, r.raw_row, sourceFile,
    );
  });

  if (mode === 'insert_only') {
    // Cron mode: sadece yeni tracking'leri ekle, mevcut kayıtlara dokunma
    const result = await pool.query(`
      INSERT INTO oms_shipments
        (tracking_number, carrier, store, order_id, label_no,
         order_date, ship_date, recipient_country, raw_row, source_file)
      VALUES ${values.join(',')}
      ON CONFLICT (tracking_number) DO NOTHING
      RETURNING tracking_number
    `, params);
    const inserted = result.rowCount || 0;
    return { inserted, updated: 0, alreadyExists: batch.length - inserted };
  }

  // 'upsert' — manuel CLI re-import için (overwrite)
  const result = await pool.query<{ inserted: boolean }>(`
    INSERT INTO oms_shipments
      (tracking_number, carrier, store, order_id, label_no,
       order_date, ship_date, recipient_country, raw_row, source_file)
    VALUES ${values.join(',')}
    ON CONFLICT (tracking_number) DO UPDATE SET
      carrier = EXCLUDED.carrier,
      store = EXCLUDED.store,
      order_id = EXCLUDED.order_id,
      label_no = EXCLUDED.label_no,
      order_date = EXCLUDED.order_date,
      ship_date = EXCLUDED.ship_date,
      recipient_country = EXCLUDED.recipient_country,
      raw_row = EXCLUDED.raw_row,
      source_file = EXCLUDED.source_file,
      uploaded_at = NOW()
    RETURNING (xmax = 0) AS inserted
  `, params);
  let inserted = 0;
  let updated = 0;
  for (const row of result.rows) {
    if (row.inserted) inserted++;
    else updated++;
  }
  return { inserted, updated, alreadyExists: 0 };
}

/**
 * Excel buffer'ından OMS shipment'ları parse edip oms_shipments'a yazar.
 *  - 'upsert' (default): mevcut kayıtlar overwrite — manuel re-upload için
 *  - 'insert_only': mevcut kayıtlar atlanır — günlük cron için
 */
export async function importShipmentsFromBuffer(
  buffer: Buffer,
  sourceFile: string,
  mode: ImportMode = 'upsert',
): Promise<ImportSummary> {
  const wb = XLSX.read(buffer, { cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('Excel sheet bulunamadı');
  const ws = wb.Sheets[sheetName];
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });

  logger.info(`[OmsImport] ${rows.length} satır parse edildi (sheet: ${sheetName}, src: ${sourceFile})`);

  const summary: ImportSummary = {
    totalRows: rows.length,
    inserted: 0,
    updated: 0,
    alreadyExists: 0,
    skippedNoTracking: 0,
    skippedNoCarrier: 0,
    carrierCounts: {},
  };

  const dedupedMap = new Map<string, PreparedRow>();
  for (const row of rows) {
    const carrier = cleanText(getCell(row, 'carrier'));
    const trackings = splitTracking(getCell(row, 'tracking'));
    if (!carrier) { summary.skippedNoCarrier++; continue; }
    if (trackings.length === 0) { summary.skippedNoTracking++; continue; }

    const store = cleanText(getCell(row, 'store'));
    const orderId = cleanText(getCell(row, 'orderId'));
    const labelNo = cleanText(getCell(row, 'labelNo'));
    const orderDate = parseDate(getCell(row, 'orderDate'));
    const shipDate = parseDate(getCell(row, 'shipDate'));
    const country = cleanText(getCell(row, 'country'));

    for (const tracking of trackings) {
      summary.carrierCounts[carrier] = (summary.carrierCounts[carrier] || 0) + 1;
      dedupedMap.set(tracking, {
        tracking_number: tracking,
        carrier,
        store,
        order_id: orderId,
        label_no: labelNo,
        order_date: orderDate,
        ship_date: shipDate,
        recipient_country: country,
        raw_row: row,
      });
    }
  }

  const preparedRows = [...dedupedMap.values()];
  for (let i = 0; i < preparedRows.length; i += BATCH_SIZE) {
    const batch = preparedRows.slice(i, i + BATCH_SIZE);
    const r = await flushBatch(batch, sourceFile, mode);
    summary.inserted += r.inserted;
    summary.updated += r.updated;
    summary.alreadyExists += r.alreadyExists;
  }

  logger.info(
    `[OmsImport] Bitti (${mode}): ${summary.inserted} insert, ${summary.updated} update, ` +
    `${summary.alreadyExists} mevcut atlandı, ${summary.skippedNoTracking + summary.skippedNoCarrier} skip`,
  );
  return summary;
}

import 'dotenv/config';
import * as XLSX from 'xlsx';
import * as path from 'path';
import { pool } from '../config/database';
import logger from '../config/logger';
import { errMessage } from '../utils/errors';

/**
 * Wisersell shipment manifest Excel'ini oms_shipments tablosuna yükler.
 *
 * Kullanım:
 *   npx ts-node src/scripts/importOmsShipments.ts ~/Desktop/wisersell-export.xlsx
 *
 * Beklenen kolonlar (header isimleri Türkçe):
 *   KARGO FIRMASI, MAGAZA, KARGO TAKIP NO, SIPARIS TARIHI, LABEL NO,
 *   SIPARIS NO, GONDERIM TARIHI, KAP ADEDI, BRUT KG, ALICI, ALICI ADRES,
 *   ALICI ULKE, MUSTERI, MUSTERI E-MAIL, MUSTERI ADRES, ...
 *
 * UPSERT mantığı: tracking_number primary key. Tekrar yüklenebilir, idempotent.
 */

const HEADER_ALIASES: Record<string, string[]> = {
  carrier:    ['KARGO FIRMASI', 'KARGO FIRMASI '],
  store:      ['MAGAZA'],
  tracking:   ['KARGO TAKIP NO'],
  orderDate:  ['SIPARIS TARIHI'],
  labelNo:    ['LABEL NO'],
  orderId:    ['SIPARIS NO'],
  shipDate:   ['GONDERIM TARIHI'],
  country:    ['ALICI ULKE'],
};

function getCell(row: Record<string, any>, key: keyof typeof HEADER_ALIASES): any {
  for (const alias of HEADER_ALIASES[key]) {
    if (alias in row) return row[alias];
  }
  return null;
}

function cleanText(value: any): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s || s === '-') return null;
  return s;
}

function parseDate(value: any): string | null {
  if (value === null || value === undefined || value === '-') return null;

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'string') {
    const s = value.trim();
    // DD/MM/YYYY (Wisersell varsayılan formatı)
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const [, dd, mm, yyyy] = m;
      return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    }
    // ISO YYYY-MM-DD
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return s.slice(0, 10);
  }

  if (typeof value === 'number') {
    const parsed = (XLSX as any).SSF?.parse_date_code?.(value);
    if (parsed && parsed.y) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }

  return null;
}

function splitTracking(value: any): string[] {
  if (value === null || value === undefined) return [];
  const cleaned = String(value).replace(/\s+/g, '');
  if (!cleaned) return [];
  // Önce comma/semicolon ile ayır
  const parts = cleaned.split(/[,;]/).map(s => s.trim()).filter(Boolean);
  // Her parça 12-haneli FedEx tracking olmalı; bazen Excel'de 24/36... haneli
  // birleşik string halinde gelebiliyor — 12'şer parçaya böl.
  const out: string[] = [];
  for (const piece of parts) {
    if (/^\d+$/.test(piece) && piece.length >= 24 && piece.length % 12 === 0) {
      for (let i = 0; i < piece.length; i += 12) {
        out.push(piece.slice(i, i + 12));
      }
    } else {
      out.push(piece);
    }
  }
  return out;
}

interface ImportSummary {
  totalRows: number;
  inserted: number;
  updated: number;
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
  raw_row: Record<string, any>;
}

const BATCH_SIZE = 500;

async function flushBatch(batch: PreparedRow[], fileName: string): Promise<{ inserted: number; updated: number }> {
  if (batch.length === 0) return { inserted: 0, updated: 0 };

  const values: string[] = [];
  const params: unknown[] = [];
  batch.forEach((r, i) => {
    const o = i * 10;
    values.push(`($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6},$${o+7},$${o+8},$${o+9},$${o+10})`);
    params.push(
      r.tracking_number, r.carrier, r.store, r.order_id, r.label_no,
      r.order_date, r.ship_date, r.recipient_country, r.raw_row, fileName,
    );
  });

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
  return { inserted, updated };
}

async function importFile(filePath: string): Promise<ImportSummary> {
  const absPath = path.resolve(filePath);
  const fileName = path.basename(absPath);

  logger.info(`[ImportOms] Reading ${absPath}`);
  const wb = XLSX.readFile(absPath, { cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    throw new Error('Excel sheet bulunamadı');
  }
  const ws = wb.Sheets[sheetName];
  const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });

  logger.info(`[ImportOms] ${rows.length} satır parse edildi (sheet: ${sheetName})`);

  const summary: ImportSummary = {
    totalRows: rows.length,
    inserted: 0,
    updated: 0,
    skippedNoTracking: 0,
    skippedNoCarrier: 0,
    carrierCounts: {},
  };

  // Aynı dosyada tracking_number tekrarı olursa son kayıt geçerli olsun
  // (PostgreSQL aynı INSERT içinde duplicate PK'ya izin vermez).
  const dedupedMap = new Map<string, PreparedRow>();

  for (const row of rows) {
    const carrier = cleanText(getCell(row, 'carrier'));
    const trackings = splitTracking(getCell(row, 'tracking'));

    if (!carrier) {
      summary.skippedNoCarrier++;
      continue;
    }
    if (trackings.length === 0) {
      summary.skippedNoTracking++;
      continue;
    }

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
  logger.info(`[ImportOms] ${preparedRows.length} unique tracking, ${BATCH_SIZE}'lı batch ile yazılıyor`);

  for (let i = 0; i < preparedRows.length; i += BATCH_SIZE) {
    const batch = preparedRows.slice(i, i + BATCH_SIZE);
    const { inserted, updated } = await flushBatch(batch, fileName);
    summary.inserted += inserted;
    summary.updated += updated;
    if ((i / BATCH_SIZE) % 10 === 0) {
      logger.info(`[ImportOms] Progress ${Math.min(i + BATCH_SIZE, preparedRows.length)}/${preparedRows.length}`);
    }
  }

  return summary;
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error('Kullanım: npx ts-node src/scripts/importOmsShipments.ts <file.xlsx>');
    process.exit(1);
  }

  try {
    const s = await importFile(file);
    logger.info(`[ImportOms] Bitti: ${s.inserted} insert, ${s.updated} update, ${s.skippedNoTracking + s.skippedNoCarrier} skip (${s.skippedNoTracking} tracking yok, ${s.skippedNoCarrier} carrier yok), toplam ${s.totalRows}`);
    logger.info('[ImportOms] Carrier dağılımı:');
    for (const [c, n] of Object.entries(s.carrierCounts).sort((a, b) => b[1] - a[1])) {
      logger.info(`[ImportOms]   ${c.padEnd(20)} ${n}`);
    }
    process.exit(0);
  } catch (err: unknown) {
    logger.error('[ImportOms] FATAL:', errMessage(err));
    if (err instanceof Error && err.stack) logger.error(err.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

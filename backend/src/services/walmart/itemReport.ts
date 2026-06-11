import axios from 'axios';
import zlib from 'zlib';
import logger from '../../config/logger';
import { withRetry } from '../../utils/retry';
import { errMessage } from '../../utils/errors';
import { walmartGet, walmartPost, type WalmartAccount } from './client';

/**
 * Walmart ITEM raporu (Reports API, on-request) — saticinin TUM listing'lerini ceker.
 * /v3/items'in yerini alir: /v3/items limit=200 + nextCursor donmuyor -> 317'nin
 * ~200'u geliyordu (eksik kapsama). Rapor full snapshot doner (Amazon
 * GET_MERCHANT_LISTINGS_ALL_DATA muadili).
 *
 * Akis:
 *  1. POST /v3/reports/reportRequests?reportType=ITEM&reportVersion=v4  -> requestId
 *  2. GET  /v3/reports/reportRequests/{requestId}  -> requestStatus, READY olana dek poll (~25 dk)
 *  3. GET  /v3/reports/downloadReport?requestId=   -> { downloadURL } (Accept: application/json)
 *  4. downloadURL (presigned) -> ZIP indir -> tek CSV entry'sini ac -> parse
 *
 * Gunde 1 kez (channel-prices cron, 11:00 UTC) calistigi icin ~25 dk poll kabul edilebilir;
 * SP-API waitForReport ile ayni uzun-poll kalibi. READY olmazsa/hata -> complete=false ->
 * cagiran delete-stale yapmaz, mevcut veri korunur (veri kaybi yok).
 */

const REPORT_TYPE = 'ITEM';
const REPORT_VERSION = 'v4';      // v4 = Buy Box + lag time dahil; probe ile dogrulandi
const POLL_INTERVAL_MS = 90_000;  // 90s — status endpoint 30s'de 429 veriyor
const POLL_MAX_ATTEMPTS = 60;     // ~90 dk tavan; rapor suresi cok degisken (gozlem: 25 dk → 52+ dk)

export interface WalmartParsedItem {
  sku: string;
  price: number | null;
  currency: string;
  status: string | null;          // Publish Status: PUBLISHED / SYSTEM_PROBLEM / ...
  lifecycle: string | null;       // Lifecycle Status: ACTIVE / ARCHIVED
  fulfillmentType: string | null; // Seller Fulfilled / WFS Eligible / Walmart Fulfilled
  lagTime: number | null;         // Fulfillment Lag Time (gun)
  title: string | null;
  wpid: string | null;
  gtin: string | null;
}

export interface FetchItemsResult {
  items: WalmartParsedItem[];
  complete: boolean; // tum snapshot guvenle alindi mi (delete-stale guvenli mi)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CreateResp {
  requestId?: string;
  requestStatus?: string;
}

async function requestItemReport(account: WalmartAccount): Promise<string> {
  const resp = await withRetry(
    () =>
      walmartPost<CreateResp>(account, '/v3/reports/reportRequests', null, {
        params: { reportType: REPORT_TYPE, reportVersion: REPORT_VERSION },
      }),
    { label: 'wm-report-request', maxRetries: 3, baseDelayMs: 3_000 },
  );
  const id = resp?.requestId;
  if (!id) throw new Error(`Walmart item report requestId yok: ${JSON.stringify(resp).slice(0, 200)}`);
  return id;
}

interface StatusResp {
  requestStatus?: string;
}

async function waitForReady(account: WalmartAccount, requestId: string): Promise<void> {
  for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
    let status: string | undefined;
    try {
      const resp = await walmartGet<StatusResp>(account, `/v3/reports/reportRequests/${requestId}`);
      status = resp?.requestStatus;
    } catch (err) {
      // 429/transient: uzun poll dongusunde withRetry yerine elle geri cekil
      const e = err as { status?: number; retryAfterMs?: number };
      const waitMs = e.status === 429 ? (e.retryAfterMs ?? 120_000) : POLL_INTERVAL_MS;
      logger.warn(`[WalmartReport] status poll hata (attempt ${attempt}/${POLL_MAX_ATTEMPTS}): ${errMessage(err)} — ${Math.round(waitMs / 1000)}s bekle`);
      await sleep(waitMs);
      continue;
    }
    if (status === 'READY') return;
    if (status === 'ERROR') throw new Error(`Walmart item report ERROR (requestId=${requestId})`);
    logger.info(`[WalmartReport] requestId=${requestId} status=${status} (attempt ${attempt}/${POLL_MAX_ATTEMPTS})`);
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Walmart item report ${POLL_MAX_ATTEMPTS} denemede READY olmadi (requestId=${requestId})`);
}

interface DownloadResp {
  downloadURL?: string;
  downloadUrl?: string;
}

async function downloadCsv(account: WalmartAccount, requestId: string): Promise<string> {
  // downloadReport (Accept: application/json) dosyayi DEGIL, presigned downloadURL'i JSON doner.
  const meta = await withRetry(
    () => walmartGet<DownloadResp>(account, '/v3/reports/downloadReport', { params: { requestId } }),
    { label: 'wm-report-dl-url', maxRetries: 3, baseDelayMs: 3_000 },
  );
  const url = meta?.downloadURL ?? meta?.downloadUrl;
  if (!url) throw new Error(`Walmart downloadReport downloadURL dondurmedi (requestId=${requestId})`);

  // presigned URL (Azure blob) — Walmart auth header'siz, binary ZIP.
  const fileResp = await withRetry(
    () => axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 120_000 }),
    { label: 'wm-report-file', maxRetries: 3, baseDelayMs: 3_000 },
  );
  return unzipSingle(Buffer.from(fileResp.data));
}

/**
 * Tek-entry ZIP'i central directory'den cozer (data descriptor / flag bit-3 guvenli:
 * boyutlari local header'dan degil central dir'den okur). zlib zip arsivi acmaz; bu
 * yuzden minimal inline reader — adm-zip bagimliligi eklemekten kacinmak icin.
 */
export function unzipSingle(buf: Buffer): string {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } // End Of Central Directory
  }
  if (eocd < 0) throw new Error('ZIP: EOCD bulunamadi');
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cdOffset) !== 0x02014b50) throw new Error('ZIP: central directory bulunamadi');
  const method = buf.readUInt16LE(cdOffset + 10);
  const compSize = buf.readUInt32LE(cdOffset + 20);
  const localHeaderOffset = buf.readUInt32LE(cdOffset + 42);
  const lhNameLen = buf.readUInt16LE(localHeaderOffset + 26);
  const lhExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + lhNameLen + lhExtraLen;
  const comp = buf.subarray(dataStart, dataStart + compSize);
  if (method === 0) return comp.toString('utf8');           // stored
  if (method === 8) return zlib.inflateRawSync(comp).toString('utf8'); // deflate
  throw new Error(`ZIP: desteklenmeyen compression method ${method}`);
}

/** Tek bir CSV satirini ayristir (cift-tirnakli alan + alan ici virgul destekli). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } // kacis: ""
        else inQuotes = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** ITEM raporu CSV'sini WalmartParsedItem listesine cevirir (kolonu basliga gore eslestirir). */
export function parseItemReportCsv(csv: string): WalmartParsedItem[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const col = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());

  const iSku = col('SKU');
  const iPrice = col('Price');
  const iCurrency = col('Currency');
  const iStatus = col('Publish Status');
  const iLife = col('Lifecycle Status');
  const iFt = col('Fulfillment Type');
  const iLag = col('Fulfillment Lag Time');
  const iName = col('Product Name');
  const iWpid = col('WPID');
  const iGtin = col('GTIN');
  if (iSku < 0) throw new Error('Walmart item report: SKU kolonu yok');

  const cell = (c: string[], idx: number) => (idx >= 0 ? (c[idx] ?? '').trim() : '');

  const out: WalmartParsedItem[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    const sku = cell(c, iSku);
    if (!sku) continue;

    const priceRaw = cell(c, iPrice);
    const price = priceRaw ? parseFloat(priceRaw) : NaN;
    const lagRaw = cell(c, iLag);
    const lag = lagRaw ? parseInt(lagRaw, 10) : NaN;

    out.push({
      sku,
      price: Number.isFinite(price) ? price : null,
      currency: cell(c, iCurrency) || 'USD',
      status: cell(c, iStatus) || null,
      lifecycle: cell(c, iLife) || null,
      fulfillmentType: cell(c, iFt) || null,
      lagTime: Number.isFinite(lag) ? lag : null,
      title: cell(c, iName) || null,
      wpid: cell(c, iWpid) || null,
      gtin: cell(c, iGtin) || null,
    });
  }
  return out;
}

/**
 * ITEM raporunu uctan uca cek: iste -> READY bekle -> indir -> ac -> parse.
 * complete=true yalnizca rapor basariyla parse edilip >0 satir geldiyse (delete-stale guvenli).
 */
export async function fetchAllItemsViaReport(account: WalmartAccount): Promise<FetchItemsResult> {
  logger.info(`[WalmartReport] '${account.label}' ITEM ${REPORT_VERSION} raporu isteniyor...`);
  const requestId = await requestItemReport(account);
  logger.info(`[WalmartReport] '${account.label}' requestId=${requestId}, READY bekleniyor (~25 dk)...`);
  await waitForReady(account, requestId);
  const csv = await downloadCsv(account, requestId);
  const items = parseItemReportCsv(csv);
  logger.info(`[WalmartReport] '${account.label}' rapor ${items.length} item parse edildi`);
  return { items, complete: items.length > 0 };
}

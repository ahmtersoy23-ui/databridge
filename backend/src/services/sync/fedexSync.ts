import { pool } from '../../config/database';
import { errMessage } from '../../utils/errors';
import { trackBatch, TRACK_BATCH_LIMIT, type FedexTrackResult } from '../fedex/client';
import { parseTrackResult, type ParsedShipment } from '../fedex/parser';
import logger from '../../config/logger';

/**
 * FedEx Track API senkronu.
 *
 * Tetiklenen işler:
 *   - oms_shipments'ta carrier='FEDEX IWA' ve fedex_synced_at IS NULL olanlar
 *     → ilk kez çekilecekler.
 *   - fedex_shipments'ta latest_status_code != 'DL' ve not_found = FALSE olup
 *     son N saatten eski olanlar → durum güncelleme.
 *   - 'DL' (delivered) ve not_found=TRUE olanlar tekrar sorulmaz (quota tasarrufu).
 *
 * Volume planı: tek call max 30 tracking, 200ms inter-batch gap → ~150 call/dk.
 * Plan dahilinde günlük 5K'ya kadar tracking ~6 dakikada işlenir.
 */

const INTER_BATCH_DELAY_MS = 200;
const DEFAULT_RESYNC_OPEN_AFTER_HOURS = 6;
const DEFAULT_LIMIT = 5000;
// Aynı FedEx Track credential'ı ile birden fazla shipper account'unun tracking'leri
// sorgulanabiliyor (IWA OAuth token'ı CITI gönderilerini de döner — 2026-05-21).
// Wisersell oms_shipments'a carrier label'larını farklı yazıyor ("FEDEX IWA" vs
// "Fedex Citi"); ikisini de tek pass'te çekiyoruz.
const DEFAULT_CARRIERS = ['FEDEX IWA', 'Fedex Citi'];

export interface FedexSyncOptions {
  carrier?: string;
  limit?: number;
  resyncOpenAfterHours?: number;
}

export interface FedexSyncResult {
  fetched: number;
  delivered: number;
  notFound: number;
  errors: number;
}

async function getPendingTrackingNumbers(opts: FedexSyncOptions): Promise<string[]> {
  const carriers = opts.carrier
    ? [opts.carrier]
    : DEFAULT_CARRIERS;
  const resyncHours = opts.resyncOpenAfterHours ?? DEFAULT_RESYNC_OPEN_AFTER_HOURS;
  const limit = opts.limit ?? DEFAULT_LIMIT;

  const sql = `
    SELECT o.tracking_number
    FROM oms_shipments o
    LEFT JOIN fedex_shipments f ON f.tracking_number = o.tracking_number
    WHERE o.carrier = ANY($1)
      AND (
        o.fedex_synced_at IS NULL
        OR (
          f.tracking_number IS NOT NULL
          AND f.not_found = FALSE
          AND (f.latest_status_code IS NULL OR f.latest_status_code <> 'DL')
          AND f.fetched_at < NOW() - ($2 || ' hours')::interval
        )
      )
    ORDER BY o.ship_date DESC NULLS LAST
    LIMIT $3
  `;
  const result = await pool.query<{ tracking_number: string }>(sql, [carriers, String(resyncHours), limit]);
  return result.rows.map(r => r.tracking_number);
}

function safeJsonStringify(v: unknown): string | null {
  if (v == null) return null;
  // PostgreSQL jsonb null byte (\x00) kabul etmez — temizle
  return JSON.stringify(v).replace(new RegExp(String.fromCharCode(0), 'g'), '');
}

async function upsertFedexShipment(s: ParsedShipment): Promise<void> {
  await pool.query(
    `
    INSERT INTO fedex_shipments (
      tracking_number, service_type, service_description,
      ship_timestamp, delivered_timestamp, estimated_delivery,
      origin_country, origin_city, origin_postal,
      dest_country, dest_state, dest_city, dest_postal,
      weight_kg, length_cm, width_cm, height_cm, dim_weight_kg,
      package_count,
      latest_status_code, latest_status_desc,
      scan_events, raw_response, not_found,
      shipper_reference,
      fetched_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23::jsonb,$24,$25,NOW(),NOW())
    ON CONFLICT (tracking_number) DO UPDATE SET
      service_type        = EXCLUDED.service_type,
      service_description = EXCLUDED.service_description,
      ship_timestamp      = EXCLUDED.ship_timestamp,
      delivered_timestamp = EXCLUDED.delivered_timestamp,
      estimated_delivery  = EXCLUDED.estimated_delivery,
      origin_country      = EXCLUDED.origin_country,
      origin_city         = EXCLUDED.origin_city,
      origin_postal       = EXCLUDED.origin_postal,
      dest_country        = EXCLUDED.dest_country,
      dest_state          = EXCLUDED.dest_state,
      dest_city           = EXCLUDED.dest_city,
      dest_postal         = EXCLUDED.dest_postal,
      weight_kg           = EXCLUDED.weight_kg,
      length_cm           = EXCLUDED.length_cm,
      width_cm            = EXCLUDED.width_cm,
      height_cm           = EXCLUDED.height_cm,
      dim_weight_kg       = EXCLUDED.dim_weight_kg,
      package_count       = EXCLUDED.package_count,
      latest_status_code  = EXCLUDED.latest_status_code,
      latest_status_desc  = EXCLUDED.latest_status_desc,
      scan_events         = EXCLUDED.scan_events,
      raw_response        = EXCLUDED.raw_response,
      not_found           = EXCLUDED.not_found,
      shipper_reference   = EXCLUDED.shipper_reference,
      fetched_at          = NOW(),
      updated_at          = NOW()
    `,
    [
      s.tracking_number,
      s.service_type,
      s.service_description,
      s.ship_timestamp,
      s.delivered_timestamp,
      s.estimated_delivery,
      s.origin_country,
      s.origin_city,
      s.origin_postal,
      s.dest_country,
      s.dest_state,
      s.dest_city,
      s.dest_postal,
      s.weight_kg,
      s.length_cm,
      s.width_cm,
      s.height_cm,
      s.dim_weight_kg,
      s.package_count,
      s.latest_status_code,
      s.latest_status_desc,
      safeJsonStringify(s.scan_events),
      safeJsonStringify(s.raw_response),
      s.not_found,
      s.shipper_reference,
    ],
  );
  await pool.query(
    'UPDATE oms_shipments SET fedex_synced_at = NOW() WHERE tracking_number = $1',
    [s.tracking_number],
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Verilen tracking listesini FedEx Track API'den çekip fedex_shipments'a UPSERT eder.
 * `syncFedex` (cron) bunu kullanır; ayrıca dış uygulamalar (cargolens misafir
 * gönderi yönlendirmesi gibi) tek tracking listesi vererek tetikleyebilir.
 * Duplikatlar dedupe edilir.
 */
export async function syncFedexTrackings(trackingNumbers: string[]): Promise<FedexSyncResult> {
  const list = [...new Set(trackingNumbers.filter(t => typeof t === 'string' && t.length > 0))];
  const result: FedexSyncResult = { fetched: 0, delivered: 0, notFound: 0, errors: 0 };
  if (list.length === 0) {
    logger.info('[FedexSync] Boş tracking listesi, skip');
    return result;
  }

  const totalBatches = Math.ceil(list.length / TRACK_BATCH_LIMIT);
  logger.info(`[FedexSync] Başlıyor: ${list.length} tracking, ${totalBatches} batch`);

  for (let i = 0; i < list.length; i += TRACK_BATCH_LIMIT) {
    const batch = list.slice(i, i + TRACK_BATCH_LIMIT);
    const batchIdx = Math.floor(i / TRACK_BATCH_LIMIT) + 1;

    let results: FedexTrackResult[];
    try {
      results = await trackBatch(batch);
    } catch (err: unknown) {
      logger.error(`[FedexSync] Batch ${batchIdx}/${totalBatches} başarısız: ${errMessage(err)}`);
      result.errors += batch.length;
      await sleep(INTER_BATCH_DELAY_MS * 5);
      continue;
    }

    for (const r of results) {
      // Transient API error → DB'ye yazma, sonraki cron tekrar dener
      if (r.isTransient) {
        logger.warn(`[FedexSync] ${r.trackingNumber} transient error skip: ${r.errorCode ?? '?'}`);
        result.errors++;
        continue;
      }
      try {
        const parsed = parseTrackResult(r);
        await upsertFedexShipment(parsed);
        result.fetched++;
        if (parsed.not_found) result.notFound++;
        else if (parsed.latest_status_code === 'DL') result.delivered++;
      } catch (err: unknown) {
        logger.error(`[FedexSync] ${r.trackingNumber} upsert hatası: ${errMessage(err)}`);
        result.errors++;
      }
    }

    if (i + TRACK_BATCH_LIMIT < list.length) {
      await sleep(INTER_BATCH_DELAY_MS);
    }
  }

  logger.info(
    `[FedexSync] Bitti: ${result.fetched} fetched (${result.delivered} delivered, ${result.notFound} not_found, ${result.errors} error)`,
  );
  return result;
}

export async function syncFedex(options: FedexSyncOptions = {}): Promise<number> {
  const trackingNumbers = await getPendingTrackingNumbers(options);
  if (trackingNumbers.length === 0) {
    logger.info('[FedexSync] Pending tracking yok, skip');
    return 0;
  }
  const r = await syncFedexTrackings(trackingNumbers);
  return r.fetched;
}

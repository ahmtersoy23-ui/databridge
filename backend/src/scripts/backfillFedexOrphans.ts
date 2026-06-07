import 'dotenv/config';
import { errMessage } from '../utils/errors';
import { Pool } from 'pg';
import { trackBatch, TRACK_BATCH_LIMIT, type FedexTrackResult } from '../services/fedex/client';
import { parseTrackResult } from '../services/fedex/parser';
import { pool as databridgePool } from '../config/database';

/**
 * Backfill: cargolens_db.invoice_shipments'ta var ama databridge_db.oms_shipments'ta
 * yok olan tracking'leri FedEx Track API ile çekip databridge_db.fedex_shipments'a yaz.
 *
 * Run (sunucuda):
 *   cd /var/www/databridge && node dist/scripts/backfillFedexOrphans.js [limit]
 *
 * limit: işlenecek max tracking sayısı. Default: 10000.
 *
 * Resync: Halihazırda fedex_shipments'ta olan tracking'ler tekrar sorulmaz
 * (idempotent — script'i tekrar çalıştırmak ek API quota harcamaz).
 */

const INTER_BATCH_DELAY_MS = 200;

async function getOrphanTrackings(limit: number): Promise<string[]> {
  const cargo = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: 'cargolens_db',
    user: process.env.CARGOLENS_DB_USER || process.env.DB_USER,
    password: process.env.CARGOLENS_DB_PASSWORD || process.env.DB_PASSWORD,
  });
  try {
    // Tüm invoice tracking'lerinden distinct, oms ve fedex'te olmayanlar
    const inv = await cargo.query<{ gonderi_no: string }>(
      `SELECT DISTINCT gonderi_no FROM invoice_shipments WHERE gonderi_no IS NOT NULL AND gonderi_no <> ''`,
    );
    const tns = inv.rows.map(r => r.gonderi_no);
    if (tns.length === 0) return [];

    const known = await databridgePool.query<{ tracking_number: string }>(
      `SELECT tracking_number FROM oms_shipments WHERE tracking_number = ANY($1::text[])
       UNION
       SELECT tracking_number FROM fedex_shipments WHERE tracking_number = ANY($1::text[])`,
      [tns],
    );
    const knownSet = new Set(known.rows.map(r => r.tracking_number));
    const orphans = tns.filter(t => !knownSet.has(t));
    return orphans.slice(0, limit);
  } finally {
    await cargo.end();
  }
}

function safeJsonStringify(v: unknown): string | null {
  if (v == null) return null;
  return JSON.stringify(v).replace(new RegExp(String.fromCharCode(0), 'g'), '');
}

async function upsertFedex(s: ReturnType<typeof parseTrackResult>): Promise<void> {
  await databridgePool.query(
    `INSERT INTO fedex_shipments (
      tracking_number, service_type, service_description,
      ship_timestamp, delivered_timestamp, estimated_delivery,
      origin_country, origin_city, origin_postal,
      dest_country, dest_state, dest_city, dest_postal,
      weight_kg, package_count,
      latest_status_code, latest_status_desc,
      scan_events, raw_response, not_found,
      shipper_reference,
      fetched_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,$20,$21,NOW(),NOW())
    ON CONFLICT (tracking_number) DO NOTHING`,
    [
      s.tracking_number, s.service_type, s.service_description,
      s.ship_timestamp, s.delivered_timestamp, s.estimated_delivery,
      s.origin_country, s.origin_city, s.origin_postal,
      s.dest_country, s.dest_state, s.dest_city, s.dest_postal,
      s.weight_kg, s.package_count,
      s.latest_status_code, s.latest_status_desc,
      safeJsonStringify(s.scan_events), safeJsonStringify(s.raw_response),
      s.not_found, s.shipper_reference,
    ],
  );
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function main(): Promise<void> {
  const limit = parseInt(process.argv[2] || '10000', 10);
  console.log(`[backfill] Orphan tracking'leri toplanıyor (limit=${limit})...`);
  const orphans = await getOrphanTrackings(limit);
  console.log(`[backfill] ${orphans.length} orphan bulundu`);
  if (orphans.length === 0) return;

  let fetched = 0, notFound = 0, withEtgb = 0, errors = 0;
  const totalBatches = Math.ceil(orphans.length / TRACK_BATCH_LIMIT);

  for (let i = 0; i < orphans.length; i += TRACK_BATCH_LIMIT) {
    const batch = orphans.slice(i, i + TRACK_BATCH_LIMIT);
    const idx = Math.floor(i / TRACK_BATCH_LIMIT) + 1;

    let results: FedexTrackResult[];
    try {
      results = await trackBatch(batch);
    } catch (err: unknown) {
      console.error(`[backfill] Batch ${idx}/${totalBatches} hata: ${errMessage(err)}`);
      errors += batch.length;
      await sleep(INTER_BATCH_DELAY_MS * 5);
      continue;
    }

    for (const r of results) {
      try {
        const parsed = parseTrackResult(r);
        await upsertFedex(parsed);
        fetched++;
        if (parsed.not_found) notFound++;
        if (parsed.shipper_reference && /etgb/i.test(parsed.shipper_reference)) withEtgb++;
      } catch (err: unknown) {
        console.error(`[backfill] ${r.trackingNumber} upsert hata: ${errMessage(err)}`);
        errors++;
      }
    }

    if (idx % 10 === 0 || idx === totalBatches) {
      console.log(`[backfill] ${idx}/${totalBatches} batch · ${fetched} fetched (${notFound} not_found, ${withEtgb} ETGB, ${errors} err)`);
    }
    if (i + TRACK_BATCH_LIMIT < orphans.length) await sleep(INTER_BATCH_DELAY_MS);
  }

  console.log(`[backfill] BITTI: ${fetched} fetched, ${notFound} not_found, ${withEtgb} ETGB, ${errors} error`);
  await databridgePool.end();
}

main().then(() => process.exit(0)).catch(err => {
  console.error('[backfill] FATAL:', err);
  process.exit(1);
});

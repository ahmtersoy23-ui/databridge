import { pool, sharedPool } from '../../config/database';
import logger from '../../config/logger';
import { notify } from '../../utils/notify';

const INDIVIDUAL_CHANNELS = ['us', 'uk', 'de', 'fr', 'it', 'es', 'ca', 'au', 'ae', 'sa', 'others'];
const EU_CHANNELS = ['de', 'fr', 'it', 'es', 'others'];

// 'combined' = NULL fulfillment (eski format, tüm Amazon dahil)
// 'Amazon'   = FBA (raw_orders.fulfillment_channel='Amazon')
// 'Merchant' = FBM (raw_orders.fulfillment_channel='Merchant')
// Global toggle filtreleri bu üç satırdan birini seçer.
export type FulfillmentTag = null | 'Amazon' | 'Merchant' | 'Wayfair';

function buildRollingSql(opts: { filterByFulfillment: boolean; euAggregate: boolean }): string {
  const channelClause = opts.euAggregate
    ? `o.channel IN ('de', 'fr', 'it', 'es', 'others')`
    : `o.channel = $1`;
  const fulfillmentClause = opts.filterByFulfillment
    ? `AND o.fulfillment_channel = $${opts.euAggregate ? 1 : 2}`
    : '';
  return `
  WITH per_sku AS (
    SELECT
      COALESCE(o.iwasku, o.sku) as iwasku,
      o.asin,
      COALESCE(SUM(CASE WHEN o.purchase_date_local >= CURRENT_DATE - 3 THEN o.quantity END), 0)::int as last3,
      COALESCE(SUM(CASE WHEN o.purchase_date_local >= CURRENT_DATE - 7 THEN o.quantity END), 0)::int as last7,
      COALESCE(SUM(CASE WHEN o.purchase_date_local >= CURRENT_DATE - 30 THEN o.quantity END), 0)::int as last30,
      COALESCE(SUM(CASE WHEN o.purchase_date_local >= CURRENT_DATE - 90 THEN o.quantity END), 0)::int as last90,
      COALESCE(SUM(CASE WHEN o.purchase_date_local >= CURRENT_DATE - 180 THEN o.quantity END), 0)::int as last180,
      COALESCE(SUM(CASE WHEN o.purchase_date_local >= CURRENT_DATE - 366 THEN o.quantity END), 0)::int as last366,
      COALESCE(SUM(CASE WHEN o.purchase_date_local BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date - 7 AND (CURRENT_DATE - INTERVAL '1 year')::date THEN o.quantity END), 0)::int as pre_year_last7,
      COALESCE(SUM(CASE WHEN o.purchase_date_local BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date - 30 AND (CURRENT_DATE - INTERVAL '1 year')::date THEN o.quantity END), 0)::int as pre_year_last30,
      COALESCE(SUM(CASE WHEN o.purchase_date_local BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date - 90 AND (CURRENT_DATE - INTERVAL '1 year')::date THEN o.quantity END), 0)::int as pre_year_last90,
      COALESCE(SUM(CASE WHEN o.purchase_date_local BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date - 180 AND (CURRENT_DATE - INTERVAL '1 year')::date THEN o.quantity END), 0)::int as pre_year_last180,
      COALESCE(SUM(CASE WHEN o.purchase_date_local BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date - 365 AND (CURRENT_DATE - INTERVAL '1 year')::date THEN o.quantity END), 0)::int as pre_year_last365,
      COALESCE(SUM(CASE WHEN o.purchase_date_local BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date AND (CURRENT_DATE - INTERVAL '1 year')::date + 7 THEN o.quantity END), 0)::int as pre_year_next7,
      COALESCE(SUM(CASE WHEN o.purchase_date_local BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date AND (CURRENT_DATE - INTERVAL '1 year')::date + 30 THEN o.quantity END), 0)::int as pre_year_next30,
      COALESCE(SUM(CASE WHEN o.purchase_date_local BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date AND (CURRENT_DATE - INTERVAL '1 year')::date + 90 THEN o.quantity END), 0)::int as pre_year_next90,
      COALESCE(SUM(CASE WHEN o.purchase_date_local BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date AND (CURRENT_DATE - INTERVAL '1 year')::date + 180 THEN o.quantity END), 0)::int as pre_year_next180
    FROM raw_orders o
    WHERE ${channelClause}
      AND o.purchase_date_local >= (CURRENT_DATE - INTERVAL '2 years')::date
      AND o.sku NOT LIKE 'amzn.gr.%'
      AND o.item_price > 0
      ${fulfillmentClause}
    GROUP BY COALESCE(o.iwasku, o.sku), o.asin
  )
  SELECT
    iwasku,
    (array_agg(asin ORDER BY last30 DESC))[1] as asin,
    SUM(last3)::int as last3,
    SUM(last7)::int as last7, SUM(last30)::int as last30,
    SUM(last90)::int as last90, SUM(last180)::int as last180,
    SUM(last366)::int as last366,
    SUM(pre_year_last7)::int as pre_year_last7, SUM(pre_year_last30)::int as pre_year_last30,
    SUM(pre_year_last90)::int as pre_year_last90, SUM(pre_year_last180)::int as pre_year_last180,
    SUM(pre_year_last365)::int as pre_year_last365,
    SUM(pre_year_next7)::int as pre_year_next7, SUM(pre_year_next30)::int as pre_year_next30,
    SUM(pre_year_next90)::int as pre_year_next90, SUM(pre_year_next180)::int as pre_year_next180
  FROM per_sku
  GROUP BY iwasku
  ORDER BY iwasku
  `;
}

const ROLLING_WINDOW_SQL = buildRollingSql({ filterByFulfillment: false, euAggregate: false });
const ROLLING_WINDOW_FBA_SQL = buildRollingSql({ filterByFulfillment: true, euAggregate: false });
const EU_AGGREGATE_SQL = buildRollingSql({ filterByFulfillment: false, euAggregate: true });
const EU_AGGREGATE_FBA_SQL = buildRollingSql({ filterByFulfillment: true, euAggregate: true });

export interface SalesRow {
  iwasku: string;
  asin: string;
  last3: number;
  last7: number;
  last30: number;
  last90: number;
  last180: number;
  last366: number;
  pre_year_last7: number;
  pre_year_last30: number;
  pre_year_last90: number;
  pre_year_last180: number;
  pre_year_last365: number;
  pre_year_next7: number;
  pre_year_next30: number;
  pre_year_next90: number;
  pre_year_next180: number;
}

const BATCH_SIZE = 500;

/**
 * upsertSalesData — bir channel için satırları yazar.
 *
 * @param channel sales_data.channel (us/uk/de/...)
 * @param rows aggregated rows
 * @param fulfillmentTag null=combined (eski format), 'Amazon'=FBA, 'Merchant'=FBM, 'Wayfair'=Wayfair
 *
 * DELETE: channel + fulfillment_channel kombosu siler (combined yazımı sadece NULL
 * satırları siler, FBA yazımı sadece Amazon satırlarını). Yeni unique index
 * (channel, iwasku, COALESCE(fulfillment_channel, '')) sayesinde 3 farklı satır
 * yan yana durabilir.
 */
export async function upsertSalesData(
  channel: string,
  rows: SalesRow[],
  fulfillmentTag: FulfillmentTag = null,
): Promise<number> {
  if (rows.length === 0) return 0;

  const client = await sharedPool.connect();
  try {
    await client.query('BEGIN');

    // Bu channel + fulfillment kombosunu sil — diğer fulfillment satırları korunur
    if (fulfillmentTag === null) {
      await client.query(
        'DELETE FROM sales_data WHERE channel = $1 AND fulfillment_channel IS NULL',
        [channel],
      );
    } else {
      await client.query(
        'DELETE FROM sales_data WHERE channel = $1 AND fulfillment_channel = $2',
        [channel, fulfillmentTag],
      );
    }

    let written = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const values: string[] = [];
      const params: any[] = [];

      batch.forEach((row, idx) => {
        const offset = idx * 19;
        const placeholders = Array.from({ length: 19 }, (_, j) => `$${offset + j + 1}`);
        values.push(`(${placeholders.join(', ')})`);
        params.push(
          channel, row.iwasku, row.asin || null, fulfillmentTag,
          row.last3, row.last7, row.last30, row.last90, row.last180, row.last366,
          row.pre_year_last7, row.pre_year_last30, row.pre_year_last90,
          row.pre_year_last180, row.pre_year_last365,
          row.pre_year_next7, row.pre_year_next30, row.pre_year_next90, row.pre_year_next180
        );
      });

      // ON CONFLICT DO UPDATE: DELETE first sayesinde conflict beklenmiyor, AMA
      // source query'de ileride bir bug duplicate üretirse "DO NOTHING" sessizce
      // ilk row'u tutardı (snapshot 2026-05-17 bug akrabası). DO UPDATE last-write-wins
      // — intent net, sessiz veri kaybı maskelenmiyor.
      await client.query(`
        INSERT INTO sales_data (channel, iwasku, asin, fulfillment_channel,
          last3, last7, last30, last90, last180, last366,
          pre_year_last7, pre_year_last30, pre_year_last90, pre_year_last180, pre_year_last365,
          pre_year_next7, pre_year_next30, pre_year_next90, pre_year_next180)
        VALUES ${values.join(', ')}
        ON CONFLICT (channel, iwasku, COALESCE(fulfillment_channel, '')) DO UPDATE SET
          asin = EXCLUDED.asin,
          last3 = EXCLUDED.last3,
          last7 = EXCLUDED.last7,
          last30 = EXCLUDED.last30,
          last90 = EXCLUDED.last90,
          last180 = EXCLUDED.last180,
          last366 = EXCLUDED.last366,
          pre_year_last7 = EXCLUDED.pre_year_last7,
          pre_year_last30 = EXCLUDED.pre_year_last30,
          pre_year_last90 = EXCLUDED.pre_year_last90,
          pre_year_last180 = EXCLUDED.pre_year_last180,
          pre_year_last365 = EXCLUDED.pre_year_last365,
          pre_year_next7 = EXCLUDED.pre_year_next7,
          pre_year_next30 = EXCLUDED.pre_year_next30,
          pre_year_next90 = EXCLUDED.pre_year_next90,
          pre_year_next180 = EXCLUDED.pre_year_next180
      `, params);

      written += batch.length;
    }

    await client.query('COMMIT');
    return written;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function writeSalesData(): Promise<void> {
  const startTime = Date.now();
  let totalRows = 0;

  logger.info('[SalesData] Starting sales_data refresh...');

  // 1. Find channels that have data
  const channelResult = await pool.query(
    'SELECT DISTINCT channel FROM raw_orders WHERE channel = ANY($1)',
    [INDIVIDUAL_CHANNELS]
  );
  const activeChannels = channelResult.rows.map((r: { channel: string }) => r.channel);
  logger.info(`[SalesData] Active channels: ${activeChannels.join(', ')}`);

  // 2. Write individual channels — 3 satır yazımı: combined + FBA + FBM
  for (const ch of activeChannels) {
    // Combined (eski format, fulfillment_channel=NULL)
    const combined = await pool.query(ROLLING_WINDOW_SQL, [ch]);
    const existing = await sharedPool.query(
      "SELECT COUNT(*)::int as cnt FROM sales_data WHERE channel = $1 AND fulfillment_channel IS NULL",
      [ch],
    );
    const existingCount = existing.rows[0].cnt;
    if (existingCount > 10 && combined.rows.length < existingCount * 0.2) {
      logger.error(`[SalesData] ${ch}: SKIPPED — new ${combined.rows.length} vs existing ${existingCount} (safety threshold)`);
      await notify(`⚠️ [SalesData] ${ch} skipped: ${combined.rows.length} rows vs ${existingCount} existing`);
      continue;
    }
    const combinedCount = await upsertSalesData(ch, combined.rows, null);
    totalRows += combinedCount;
    logger.info(`[SalesData] ${ch} combined: ${combinedCount} rows`);

    // FBA (fulfillment_channel='Amazon')
    const fba = await pool.query(ROLLING_WINDOW_FBA_SQL, [ch, 'Amazon']);
    if (fba.rows.length > 0) {
      const fbaCount = await upsertSalesData(ch, fba.rows, 'Amazon');
      totalRows += fbaCount;
      logger.info(`[SalesData] ${ch} FBA: ${fbaCount} rows`);
    }

    // FBM (fulfillment_channel='Merchant')
    const fbm = await pool.query(ROLLING_WINDOW_FBA_SQL, [ch, 'Merchant']);
    if (fbm.rows.length > 0) {
      const fbmCount = await upsertSalesData(ch, fbm.rows, 'Merchant');
      totalRows += fbmCount;
      logger.info(`[SalesData] ${ch} FBM: ${fbmCount} rows`);
    }
  }

  // 3. Write aggregated "eu" channel — combined + FBA + FBM
  const hasEuData = activeChannels.some((ch: string) => EU_CHANNELS.includes(ch));
  if (hasEuData) {
    const euCombined = await pool.query(EU_AGGREGATE_SQL);
    totalRows += await upsertSalesData('eu', euCombined.rows, null);
    logger.info(`[SalesData] eu combined: ${euCombined.rows.length} rows`);

    const euFba = await pool.query(EU_AGGREGATE_FBA_SQL, ['Amazon']);
    if (euFba.rows.length > 0) {
      totalRows += await upsertSalesData('eu', euFba.rows, 'Amazon');
      logger.info(`[SalesData] eu FBA: ${euFba.rows.length} rows`);
    }

    const euFbm = await pool.query(EU_AGGREGATE_FBA_SQL, ['Merchant']);
    if (euFbm.rows.length > 0) {
      totalRows += await upsertSalesData('eu', euFbm.rows, 'Merchant');
      logger.info(`[SalesData] eu FBM: ${euFbm.rows.length} rows`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logger.info(`[SalesData] Refresh complete: ${totalRows} total rows, ${elapsed}s`);
}

import { pool, sharedPool } from '../../config/database';
import logger from '../../config/logger';

const INDIVIDUAL_CHANNELS = ['us', 'uk', 'de', 'fr', 'it', 'es', 'ca', 'au', 'ae', 'sa', 'others'];
const EU_CHANNELS = ['de', 'fr', 'it', 'es', 'others'];

// Aggregate per iwasku (not per iwasku+asin) since sales_data has UNIQUE(iwasku, channel)
// Uses CTE to first aggregate per (iwasku, asin), then merges by iwasku picking best ASIN
const ROLLING_WINDOW_SQL = `
  WITH per_sku AS (
    SELECT
      COALESCE(o.iwasku, o.sku) as iwasku,
      o.asin,
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
    WHERE o.channel = $1
      AND o.purchase_date_local >= (CURRENT_DATE - INTERVAL '2 years')::date
      AND o.sku NOT LIKE 'amzn.gr.%'
    GROUP BY COALESCE(o.iwasku, o.sku), o.asin
  )
  SELECT
    iwasku,
    (array_agg(asin ORDER BY last30 DESC))[1] as asin,
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

// EU aggregate: sum across de/fr/it/es, pick ASIN with highest last30
const EU_AGGREGATE_SQL = `
  WITH per_sku AS (
    SELECT
      COALESCE(o.iwasku, o.sku) as iwasku,
      o.asin,
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
    WHERE o.channel IN ('de', 'fr', 'it', 'es')
      AND o.purchase_date_local >= (CURRENT_DATE - INTERVAL '2 years')::date
      AND o.sku NOT LIKE 'amzn.gr.%'
    GROUP BY COALESCE(o.iwasku, o.sku), o.asin
  )
  SELECT
    iwasku,
    (array_agg(asin ORDER BY last30 DESC))[1] as asin,
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

interface SalesRow {
  iwasku: string;
  asin: string;
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

async function upsertSalesData(channel: string, rows: SalesRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  let written = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values: string[] = [];
    const params: any[] = [];

    batch.forEach((row, idx) => {
      const offset = idx * 17;
      const placeholders = Array.from({ length: 17 }, (_, j) => `$${offset + j + 1}`);
      values.push(`(${placeholders.join(', ')})`);
      params.push(
        channel, row.iwasku, row.asin || null,
        row.last7, row.last30, row.last90, row.last180, row.last366,
        row.pre_year_last7, row.pre_year_last30, row.pre_year_last90,
        row.pre_year_last180, row.pre_year_last365,
        row.pre_year_next7, row.pre_year_next30, row.pre_year_next90, row.pre_year_next180
      );
    });

    await sharedPool.query(`
      INSERT INTO sales_data (channel, iwasku, asin,
        last7, last30, last90, last180, last366,
        pre_year_last7, pre_year_last30, pre_year_last90, pre_year_last180, pre_year_last365,
        pre_year_next7, pre_year_next30, pre_year_next90, pre_year_next180)
      VALUES ${values.join(', ')}
      ON CONFLICT (iwasku, channel) DO UPDATE SET
        asin = EXCLUDED.asin,
        last7 = EXCLUDED.last7, last30 = EXCLUDED.last30, last90 = EXCLUDED.last90,
        last180 = EXCLUDED.last180, last366 = EXCLUDED.last366,
        pre_year_last7 = EXCLUDED.pre_year_last7, pre_year_last30 = EXCLUDED.pre_year_last30,
        pre_year_last90 = EXCLUDED.pre_year_last90, pre_year_last180 = EXCLUDED.pre_year_last180,
        pre_year_last365 = EXCLUDED.pre_year_last365,
        pre_year_next7 = EXCLUDED.pre_year_next7, pre_year_next30 = EXCLUDED.pre_year_next30,
        pre_year_next90 = EXCLUDED.pre_year_next90, pre_year_next180 = EXCLUDED.pre_year_next180,
        updated_at = NOW()
    `, params);

    written += batch.length;
  }

  return written;
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

  // 2. Write individual channels
  for (const ch of activeChannels) {
    const result = await pool.query(ROLLING_WINDOW_SQL, [ch]);
    const count = await upsertSalesData(ch, result.rows);
    totalRows += count;
    logger.info(`[SalesData] ${ch}: ${count} rows`);
  }

  // 3. Write aggregated "eu" channel (de+fr+it+es)
  const hasEuData = activeChannels.some((ch: string) => EU_CHANNELS.includes(ch));
  if (hasEuData) {
    const euResult = await pool.query(EU_AGGREGATE_SQL);
    const euCount = await upsertSalesData('eu', euResult.rows);
    totalRows += euCount;
    logger.info(`[SalesData] eu (aggregate): ${euCount} rows`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logger.info(`[SalesData] Refresh complete: ${totalRows} total rows, ${elapsed}s`);
}

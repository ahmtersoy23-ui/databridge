import { pool } from '../../config/database';
import { upsertSalesData, SalesRow } from './salesDataWriter';
import { type WayfairAccount } from '../wayfair/client';
import logger from '../../config/logger';

const WAYFAIR_ROLLING_WINDOW_SQL = `
  WITH per_sku AS (
    SELECT
      iwasku,
      part_number,
      COALESCE(SUM(CASE WHEN po_date >= CURRENT_DATE - 3 THEN quantity END), 0)::int as last3,
      COALESCE(SUM(CASE WHEN po_date >= CURRENT_DATE - 7 THEN quantity END), 0)::int as last7,
      COALESCE(SUM(CASE WHEN po_date >= CURRENT_DATE - 30 THEN quantity END), 0)::int as last30,
      COALESCE(SUM(CASE WHEN po_date >= CURRENT_DATE - 90 THEN quantity END), 0)::int as last90,
      COALESCE(SUM(CASE WHEN po_date >= CURRENT_DATE - 180 THEN quantity END), 0)::int as last180,
      COALESCE(SUM(CASE WHEN po_date >= CURRENT_DATE - 366 THEN quantity END), 0)::int as last366,
      COALESCE(SUM(CASE WHEN po_date BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date - 7 AND (CURRENT_DATE - INTERVAL '1 year')::date THEN quantity END), 0)::int as pre_year_last7,
      COALESCE(SUM(CASE WHEN po_date BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date - 30 AND (CURRENT_DATE - INTERVAL '1 year')::date THEN quantity END), 0)::int as pre_year_last30,
      COALESCE(SUM(CASE WHEN po_date BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date - 90 AND (CURRENT_DATE - INTERVAL '1 year')::date THEN quantity END), 0)::int as pre_year_last90,
      COALESCE(SUM(CASE WHEN po_date BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date - 180 AND (CURRENT_DATE - INTERVAL '1 year')::date THEN quantity END), 0)::int as pre_year_last180,
      COALESCE(SUM(CASE WHEN po_date BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date - 365 AND (CURRENT_DATE - INTERVAL '1 year')::date THEN quantity END), 0)::int as pre_year_last365,
      COALESCE(SUM(CASE WHEN po_date BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date AND (CURRENT_DATE - INTERVAL '1 year')::date + 7 THEN quantity END), 0)::int as pre_year_next7,
      COALESCE(SUM(CASE WHEN po_date BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date AND (CURRENT_DATE - INTERVAL '1 year')::date + 30 THEN quantity END), 0)::int as pre_year_next30,
      COALESCE(SUM(CASE WHEN po_date BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date AND (CURRENT_DATE - INTERVAL '1 year')::date + 90 THEN quantity END), 0)::int as pre_year_next90,
      COALESCE(SUM(CASE WHEN po_date BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date AND (CURRENT_DATE - INTERVAL '1 year')::date + 180 THEN quantity END), 0)::int as pre_year_next180
    FROM wayfair_orders
    WHERE iwasku IS NOT NULL
      AND account_id = $1
      AND po_date >= (CURRENT_DATE - INTERVAL '2 years')::date
    GROUP BY iwasku, part_number
  )
  SELECT
    iwasku,
    (array_agg(part_number ORDER BY last30 DESC))[1] as asin,
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

export async function writeWayfairSalesData(account: WayfairAccount): Promise<number> {
  const result = await pool.query<SalesRow>(WAYFAIR_ROLLING_WINDOW_SQL, [account.id]);
  const count = await upsertSalesData(account.channel, result.rows);
  logger.info(`[WayfairSalesData] Wrote ${count} rows to sales_data (channel=${account.channel})`);
  return count;
}

import { pool } from '../../config/database';
import { upsertSalesData, type SalesRow } from './salesDataWriter';
import logger from '../../config/logger';

// Walmart icin sales_data agregasyonu.
// walmart_raw_orders -> iwasku basina rolling pencereler (last3/7/30/90/180/366 + previous year).
// Sonra sales_data tablosuna channel='walmart' olarak upsert eder (StockPulse okur).
//
// Filtreler:
//   - iwasku IS NOT NULL  (resolve olmamis SKU'lar aggregation'a girmez)
//   - quantity > 0        (iade/iptal satirlari item_price=0 olur, dahil edilmez)
//
// ASIN: ayni iwasku icin gozlemlenen en yakin tarihli ASIN'i kullanir (raw_orders'da ASIN kolonu yok,
// bu yuzden sku alanini ASIN gibi degerlendiririz — Walmart seller cogunlukla ASIN'i SKU olarak giriyor).
const WALMART_ROLLING_WINDOW_SQL = `
  WITH per_sku AS (
    SELECT
      iwasku,
      sku,
      COALESCE(SUM(CASE WHEN order_date_local >= CURRENT_DATE - 3   THEN quantity END), 0)::int as last3,
      COALESCE(SUM(CASE WHEN order_date_local >= CURRENT_DATE - 7   THEN quantity END), 0)::int as last7,
      COALESCE(SUM(CASE WHEN order_date_local >= CURRENT_DATE - 30  THEN quantity END), 0)::int as last30,
      COALESCE(SUM(CASE WHEN order_date_local >= CURRENT_DATE - 90  THEN quantity END), 0)::int as last90,
      COALESCE(SUM(CASE WHEN order_date_local >= CURRENT_DATE - 180 THEN quantity END), 0)::int as last180,
      COALESCE(SUM(CASE WHEN order_date_local >= CURRENT_DATE - 366 THEN quantity END), 0)::int as last366,
      COALESCE(SUM(CASE WHEN order_date_local BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date - 7   AND (CURRENT_DATE - INTERVAL '1 year')::date THEN quantity END), 0)::int as pre_year_last7,
      COALESCE(SUM(CASE WHEN order_date_local BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date - 30  AND (CURRENT_DATE - INTERVAL '1 year')::date THEN quantity END), 0)::int as pre_year_last30,
      COALESCE(SUM(CASE WHEN order_date_local BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date - 90  AND (CURRENT_DATE - INTERVAL '1 year')::date THEN quantity END), 0)::int as pre_year_last90,
      COALESCE(SUM(CASE WHEN order_date_local BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date - 180 AND (CURRENT_DATE - INTERVAL '1 year')::date THEN quantity END), 0)::int as pre_year_last180,
      COALESCE(SUM(CASE WHEN order_date_local BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date - 365 AND (CURRENT_DATE - INTERVAL '1 year')::date THEN quantity END), 0)::int as pre_year_last365,
      COALESCE(SUM(CASE WHEN order_date_local BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date       AND (CURRENT_DATE - INTERVAL '1 year')::date + 7   THEN quantity END), 0)::int as pre_year_next7,
      COALESCE(SUM(CASE WHEN order_date_local BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date       AND (CURRENT_DATE - INTERVAL '1 year')::date + 30  THEN quantity END), 0)::int as pre_year_next30,
      COALESCE(SUM(CASE WHEN order_date_local BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date       AND (CURRENT_DATE - INTERVAL '1 year')::date + 90  THEN quantity END), 0)::int as pre_year_next90,
      COALESCE(SUM(CASE WHEN order_date_local BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date       AND (CURRENT_DATE - INTERVAL '1 year')::date + 180 THEN quantity END), 0)::int as pre_year_next180
    FROM walmart_raw_orders
    WHERE iwasku IS NOT NULL
      AND quantity > 0
      AND order_date_local >= (CURRENT_DATE - INTERVAL '2 years')::date
    GROUP BY iwasku, sku
  )
  SELECT
    iwasku,
    (array_agg(sku ORDER BY last30 DESC))[1] as asin,
    SUM(last3)::int as last3,
    SUM(last7)::int as last7,
    SUM(last30)::int as last30,
    SUM(last90)::int as last90,
    SUM(last180)::int as last180,
    SUM(last366)::int as last366,
    SUM(pre_year_last7)::int as pre_year_last7,
    SUM(pre_year_last30)::int as pre_year_last30,
    SUM(pre_year_last90)::int as pre_year_last90,
    SUM(pre_year_last180)::int as pre_year_last180,
    SUM(pre_year_last365)::int as pre_year_last365,
    SUM(pre_year_next7)::int as pre_year_next7,
    SUM(pre_year_next30)::int as pre_year_next30,
    SUM(pre_year_next90)::int as pre_year_next90,
    SUM(pre_year_next180)::int as pre_year_next180
  FROM per_sku
  GROUP BY iwasku
  ORDER BY iwasku
`;

export async function writeWalmartSalesData(): Promise<number> {
  const result = await pool.query<SalesRow>(WALMART_ROLLING_WINDOW_SQL);
  const count = await upsertSalesData('walmart', result.rows, null);
  logger.info(`[WalmartSalesData] walmart: ${count} rows aggregated into sales_data`);
  return count;
}

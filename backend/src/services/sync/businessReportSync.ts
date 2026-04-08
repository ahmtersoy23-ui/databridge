import { pool } from '../../config/database';
import { fetchBusinessReport } from '../spApi/businessReport';
import { withRetry } from '../../utils/retry';
import logger from '../../config/logger';
import type { MarketplaceConfig } from '../../types';

/**
 * Business Reports sync for all active marketplaces.
 * GET_SALES_AND_TRAFFIC_REPORT is marketplace-specific (unlike orders which are region-wide).
 * Fetches last 5 days (48-72h lag typical for Business Reports).
 */
export async function runBusinessReportSync(): Promise<number> {
  const result = await pool.query(`
    SELECT mc.*
    FROM marketplace_config mc
    JOIN sp_api_credentials cred ON mc.credential_id = cred.id AND cred.is_active = true
    WHERE mc.is_active = true
    ORDER BY mc.country_code
  `);
  const marketplaces: MarketplaceConfig[] = result.rows;

  if (!marketplaces.length) {
    logger.info('[BusinessReportSync] No active marketplaces');
    return 0;
  }

  // Business Reports are per-marketplace (not per-credential like orders)
  // But we dedupe by credential+marketplace to avoid duplicate calls
  const seen = new Set<string>();
  const uniqueMarketplaces: MarketplaceConfig[] = [];
  for (const mp of marketplaces) {
    const key = `${mp.credential_id}|${mp.marketplace_id}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueMarketplaces.push(mp);
    }
  }

  logger.info(`[BusinessReportSync] Starting sync for ${uniqueMarketplaces.length} marketplaces`);

  // Fetch yesterday's data (1-day window).
  // Business Reports are ASIN aggregate per period — daily cron accumulates ASIN × day data.
  // 48-72h lag is typical; missing data will be filled on next day's run via ON CONFLICT upsert.
  // NOTE: SP-API dataEndTime is EXCLUSIVE — for 1-day window, end must be start + 1 day.
  const startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() - 1); // yesterday
  const endDate = new Date(startDate);
  endDate.setUTCDate(endDate.getUTCDate() + 1); // today (exclusive end)

  let totalRows = 0;
  for (const mp of uniqueMarketplaces) {
    try {
      const count = await withRetry(
        () => fetchBusinessReport(mp, startDate, endDate),
        { label: `business-report:${mp.country_code}` },
      );
      totalRows += count;
    } catch (err: any) {
      logger.error(`[BusinessReportSync] Failed for ${mp.country_code}: ${err.message}`);
    }
    // Rate limit between marketplace calls
    await new Promise(resolve => setTimeout(resolve, 5_000));
  }

  logger.info(`[BusinessReportSync] Complete — ${totalRows} total rows`);
  return totalRows;
}

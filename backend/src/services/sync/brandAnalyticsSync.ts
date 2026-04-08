import { pool } from '../../config/database';
import { fetchBrandAnalyticsSqp } from '../spApi/brandAnalyticsSqp';
import { withRetry } from '../../utils/retry';
import logger from '../../config/logger';
import type { MarketplaceConfig } from '../../types';

/**
 * Brand Analytics SQP sync. Weekly cadence — fetches last week's data.
 * Brand Analytics reports have 3-4 day lag and are weekly (week ending Sunday).
 * Only syncs major marketplaces (US, UK, DE) where Brand Registry is active.
 */
const SQP_MARKETPLACE_CODES = ['US'];

export async function runBrandAnalyticsSync(): Promise<number> {
  const result = await pool.query(`
    SELECT mc.*
    FROM marketplace_config mc
    JOIN sp_api_credentials cred ON mc.credential_id = cred.id AND cred.is_active = true
    WHERE mc.is_active = true AND mc.country_code = ANY($1)
    ORDER BY mc.country_code
  `, [SQP_MARKETPLACE_CODES]);
  const marketplaces: MarketplaceConfig[] = result.rows;

  if (!marketplaces.length) {
    logger.info('[BrandAnalyticsSync] No eligible marketplaces');
    return 0;
  }

  logger.info(`[BrandAnalyticsSync] Starting sync for ${marketplaces.length} marketplaces`);

  // Date range: previous full week (Sunday to Saturday)
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun
  // Go back to last Sunday
  const lastSunday = new Date(now);
  lastSunday.setUTCDate(now.getUTCDate() - dayOfWeek - 7);
  lastSunday.setUTCHours(0, 0, 0, 0);
  // Saturday end
  const lastSaturday = new Date(lastSunday);
  lastSaturday.setUTCDate(lastSunday.getUTCDate() + 6);
  lastSaturday.setUTCHours(23, 59, 59, 999);

  let totalRows = 0;
  for (const mp of marketplaces) {
    try {
      const count = await withRetry(
        () => fetchBrandAnalyticsSqp(mp, lastSunday, lastSaturday),
        { label: `brand-analytics:${mp.country_code}` },
      );
      totalRows += count;
    } catch (err: any) {
      logger.error(`[BrandAnalyticsSync] Failed for ${mp.country_code}: ${err.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, 5_000));
  }

  logger.info(`[BrandAnalyticsSync] Complete — ${totalRows} total rows`);
  return totalRows;
}

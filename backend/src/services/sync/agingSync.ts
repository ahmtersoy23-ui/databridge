import { pool } from '../../config/database';
import { fetchAndWriteAgingReport } from '../spApi/agingReport';
import { withRetry } from '../../utils/retry';
import logger from '../../config/logger';
import type { MarketplaceConfig } from '../../types';

/**
 * Run aging report sync for all active credentials.
 *
 * Groups by credential_id + warehouse (same as inventory sync) so that
 * each FBA warehouse is fetched once. The report replaces all data for
 * that warehouse.
 */
export async function runAgingSync(): Promise<void> {
  const result = await pool.query(`
    SELECT mc.*
    FROM marketplace_config mc
    JOIN sp_api_credentials cred ON mc.credential_id = cred.id AND cred.is_active = true
    WHERE mc.is_active = true
    ORDER BY mc.country_code
  `);
  const marketplaces: MarketplaceConfig[] = result.rows;

  // Group by credential_id + warehouse — one report per warehouse
  const byGroup = new Map<string, MarketplaceConfig>();
  for (const mp of marketplaces) {
    const key = `${mp.credential_id}|${mp.warehouse}`;
    if (!byGroup.has(key)) {
      byGroup.set(key, mp); // take the first representative
    }
  }

  logger.info(`[AgingSync] Starting aging sync: ${byGroup.size} warehouse groups`);

  let totalRows = 0;
  for (const [key, mp] of byGroup) {
    try {
      logger.info(`[AgingSync] Fetching aging for ${key} (${mp.country_code}, warehouse: ${mp.warehouse})`);
      const count = await withRetry(() => fetchAndWriteAgingReport(mp), { label: `aging:${key}` });
      totalRows += count;
    } catch (err: any) {
      logger.error(`[AgingSync] Failed for ${key} (${mp.country_code}):`, err.message);
    }
    // Rate limit between credential calls
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  logger.info(`[AgingSync] Complete — ${totalRows} total rows across ${byGroup.size} warehouses`);
}

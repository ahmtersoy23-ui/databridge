import cron from 'node-cron';
import { pool } from '../../config/database';
import { syncInventoryForMarketplace } from './inventorySync';
import { syncSalesForMarketplace } from './salesSync';
import { writeSalesData } from './salesDataWriter';
import { writeInventoryData } from './inventoryDataWriter';
import logger from '../../config/logger';
import { SYNC_INVENTORY_CRON, SYNC_SALES_CRON } from '../../config/constants';
import type { MarketplaceConfig } from '../../types';

let inventoryTask: cron.ScheduledTask | null = null;
let salesTask: cron.ScheduledTask | null = null;
let isSyncing = false;

async function getActiveMarketplaces(): Promise<MarketplaceConfig[]> {
  const result = await pool.query(
    'SELECT * FROM marketplace_config WHERE is_active = true ORDER BY country_code'
  );
  return result.rows;
}

async function getEligibleMarketplaces(): Promise<MarketplaceConfig[]> {
  // Only return marketplaces that have an active linked credential
  const result = await pool.query(`
    SELECT mc.*
    FROM marketplace_config mc
    JOIN sp_api_credentials cred ON mc.credential_id = cred.id AND cred.is_active = true
    WHERE mc.is_active = true
    ORDER BY mc.country_code
  `);
  return result.rows;
}

async function runInventorySync(): Promise<void> {
  if (isSyncing) {
    logger.warn('[Scheduler] Skipping inventory sync - another sync is in progress');
    return;
  }

  isSyncing = true;
  try {
    const eligibleMarketplaces = await getEligibleMarketplaces();

    // Group by credential_id + warehouse — same credential+warehouse returns identical inventory
    // e.g. DE/FR/IT/ES all share credential 4 + warehouse EU → one call covers all
    const byGroup = new Map<string, MarketplaceConfig[]>();
    for (const mp of eligibleMarketplaces) {
      const key = `${mp.credential_id}|${mp.warehouse}`;
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key)!.push(mp);
    }

    logger.info(`[Scheduler] Inventory sync: ${byGroup.size} unique credential+warehouse groups (${eligibleMarketplaces.length} marketplaces)`);

    for (const [key, group] of byGroup) {
      const representative = group[0];
      const channels = group.map(m => m.country_code).join(',');
      try {
        logger.info(`[Scheduler] Inventory sync ${key}: ${channels} (via ${representative.country_code})`);
        await syncInventoryForMarketplace(representative);
      } catch (err: any) {
        logger.error(`[Scheduler] Inventory sync failed for ${key} (${representative.country_code}):`, err.message);
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Refresh aggregated fba_inventory in pricelab_db after all warehouse syncs
    try {
      await writeInventoryData();
    } catch (err: any) {
      logger.error('[Scheduler] writeInventoryData error:', err.message);
    }
  } finally {
    isSyncing = false;
  }
}

async function runSalesSync(): Promise<void> {
  if (isSyncing) {
    logger.warn('[Scheduler] Skipping sales sync - another sync is in progress');
    return;
  }

  isSyncing = true;
  try {
    const eligibleMarketplaces = await getEligibleMarketplaces();

    // Group by credential_id — SP-API returns all orders for the entire region
    // in a single call, so we only need one call per credential
    const byCredential = new Map<number, MarketplaceConfig[]>();
    for (const mp of eligibleMarketplaces) {
      const credId = mp.credential_id!; // guaranteed non-null by getEligibleMarketplaces JOIN
      if (!byCredential.has(credId)) byCredential.set(credId, []);
      byCredential.get(credId)!.push(mp);
    }

    logger.info(`[Scheduler] Sales sync: ${byCredential.size} credentials (${eligibleMarketplaces.length} marketplaces)`);

    for (const [credId, group] of byCredential) {
      const representative = group[0];
      const channels = group.map(m => m.channel).join(',');
      try {
        logger.info(`[Scheduler] Syncing credential ${credId}: ${channels} (via ${representative.country_code})`);
        await syncSalesForMarketplace(representative);
      } catch (err: any) {
        logger.error(`[Scheduler] Sales sync failed for credential ${credId} (${representative.country_code}):`, err.message);
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    // Refresh aggregated sales_data in pricelab_db after all marketplace syncs
    try {
      await writeSalesData();
    } catch (err: any) {
      logger.error('[Scheduler] writeSalesData error:', err.message);
    }
  } finally {
    isSyncing = false;
  }
}

export function startScheduler(): void {
  inventoryTask = cron.schedule(SYNC_INVENTORY_CRON, () => {
    logger.info('[Scheduler] Starting scheduled inventory sync');
    runInventorySync().catch(err => logger.error('[Scheduler] Inventory sync error:', err));
  });

  salesTask = cron.schedule(SYNC_SALES_CRON, () => {
    logger.info('[Scheduler] Starting scheduled sales sync');
    runSalesSync().catch(err => logger.error('[Scheduler] Sales sync error:', err));
  });

  logger.info(`[Scheduler] Inventory sync: ${SYNC_INVENTORY_CRON}`);
  logger.info(`[Scheduler] Sales sync: ${SYNC_SALES_CRON}`);
}

export function stopScheduler(): void {
  inventoryTask?.stop();
  salesTask?.stop();
  logger.info('[Scheduler] Stopped all scheduled tasks');
}

export { runInventorySync, runSalesSync, getActiveMarketplaces, isSyncing, writeSalesData, writeInventoryData };

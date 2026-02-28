import cron from 'node-cron';
import { pool } from '../../config/database';
import { syncInventoryForMarketplace } from './inventorySync';
import { syncSalesForMarketplace } from './salesSync';
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

async function hasCredentials(region: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT COUNT(*) as count FROM sp_api_credentials WHERE region = $1 AND is_active = true',
    [region]
  );
  return parseInt(result.rows[0].count) > 0;
}

async function runInventorySync(): Promise<void> {
  if (isSyncing) {
    logger.warn('[Scheduler] Skipping inventory sync - another sync is in progress');
    return;
  }

  isSyncing = true;
  try {
    const marketplaces = await getActiveMarketplaces();

    // Group by region to check credentials
    const regions = [...new Set(marketplaces.map(m => m.region))];
    const activeRegions: string[] = [];

    for (const region of regions) {
      if (await hasCredentials(region)) {
        activeRegions.push(region);
      } else {
        logger.warn(`[Scheduler] No credentials for region ${region}, skipping`);
      }
    }

    const eligibleMarketplaces = marketplaces.filter(m => activeRegions.includes(m.region));

    for (const mp of eligibleMarketplaces) {
      try {
        await syncInventoryForMarketplace(mp);
      } catch (err: any) {
        logger.error(`[Scheduler] Inventory sync failed for ${mp.country_code}:`, err.message);
      }
      // Brief pause between marketplaces
      await new Promise(resolve => setTimeout(resolve, 2000));
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
    const marketplaces = await getActiveMarketplaces();
    const regions = [...new Set(marketplaces.map(m => m.region))];
    const activeRegions: string[] = [];

    for (const region of regions) {
      if (await hasCredentials(region)) {
        activeRegions.push(region);
      }
    }

    const eligibleMarketplaces = marketplaces.filter(m => activeRegions.includes(m.region));

    for (const mp of eligibleMarketplaces) {
      try {
        await syncSalesForMarketplace(mp);
      } catch (err: any) {
        logger.error(`[Scheduler] Sales sync failed for ${mp.country_code}:`, err.message);
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
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

export { runInventorySync, runSalesSync, getActiveMarketplaces, isSyncing };

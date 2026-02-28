import cron from 'node-cron';
import { pool } from '../../config/database';
import { syncInventoryForMarketplace } from './inventorySync';
import { syncSalesForMarketplace } from './salesSync';
import { writeSalesData } from './salesDataWriter';
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
    logger.info(`[Scheduler] Inventory sync: ${eligibleMarketplaces.length} eligible marketplaces`);

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
    const eligibleMarketplaces = await getEligibleMarketplaces();
    logger.info(`[Scheduler] Sales sync: ${eligibleMarketplaces.length} eligible marketplaces`);

    for (const mp of eligibleMarketplaces) {
      try {
        await syncSalesForMarketplace(mp);
      } catch (err: any) {
        logger.error(`[Scheduler] Sales sync failed for ${mp.country_code}:`, err.message);
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

export { runInventorySync, runSalesSync, getActiveMarketplaces, isSyncing, writeSalesData };

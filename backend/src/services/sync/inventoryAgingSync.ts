import { pool } from '../../config/database';
import { fetchFbaInventoryAging } from '../spApi/inventoryAging';
import { mapBulkSkusToIwasku } from '../skuMapper';
import logger from '../../config/logger';
import type { MarketplaceConfig, FbaInventoryAgingItem } from '../../types';

export async function syncInventoryAgingForMarketplace(marketplace: MarketplaceConfig): Promise<number> {
  const jobId = await createSyncJob('inventory_aging_sync', marketplace.country_code);

  try {
    await updateSyncJob(jobId, 'running');

    const items = await fetchFbaInventoryAging(marketplace);
    if (items.length === 0) {
      await updateSyncJob(jobId, 'completed', 0);
      return 0;
    }

    // Map SKUs to iwasku
    const skuMappings = await mapBulkSkusToIwasku(
      items.map(i => ({ sku: i.sku, countryCode: marketplace.country_code, asin: i.asin || '' }))
    );

    for (const item of items) {
      item.iwasku = skuMappings.get(item.sku) || null;
    }

    await upsertInventoryAging(marketplace.warehouse, items);

    await updateSyncJob(jobId, 'completed', items.length);
    logger.info(`[Sync] Inventory aging sync completed for ${marketplace.country_code}: ${items.length} items`);
    return items.length;
  } catch (err: any) {
    logger.error(`[Sync] Inventory aging sync failed for ${marketplace.country_code}:`, err.message);
    await updateSyncJob(jobId, 'failed', 0, err.message);
    throw err;
  }
}

async function upsertInventoryAging(warehouse: string, items: FbaInventoryAgingItem[]): Promise<void> {
  const BATCH_SIZE = 500;
  const COLS_PER_ROW = 37;

  await pool.query('DELETE FROM fba_inventory_aging WHERE warehouse = $1', [warehouse]);

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const values: string[] = [];
    const params: any[] = [];

    batch.forEach((item, idx) => {
      const offset = idx * COLS_PER_ROW;
      const placeholders = Array.from({ length: COLS_PER_ROW }, (_, j) => `$${offset + j + 1}`);
      values.push(`(${placeholders.join(', ')})`);
      params.push(
        item.warehouse,
        item.marketplace_id,
        item.snapshot_date,
        item.sku,
        item.fnsku,
        item.asin,
        item.iwasku,
        item.product_name,
        item.condition,
        item.available_quantity,
        item.qty_with_removals_in_progress,
        item.inv_age_0_to_90_days,
        item.inv_age_91_to_180_days,
        item.inv_age_181_to_270_days,
        item.inv_age_271_to_365_days,
        item.inv_age_365_plus_days,
        item.currency,
        item.estimated_ltsf_next_charge,
        item.per_unit_volume,
        item.is_hazmat,
        item.in_date,
        item.units_shipped_last_7_days,
        item.units_shipped_last_30_days,
        item.units_shipped_last_60_days,
        item.units_shipped_last_90_days,
        item.recommended_removal_quantity,
        item.estimated_ltsf_6_mo,
        item.estimated_ltsf_12_mo,
        item.alert,
        item.your_price,
        item.sales_price,
        item.sell_through,
        item.storage_type,
        item.recommended_action,
        item.estimated_cost_savings,
        item.healthy_inventory_level,
        new Date(), // last_synced_at
      );
    });

    await pool.query(`
      INSERT INTO fba_inventory_aging (
        warehouse, marketplace_id, snapshot_date, sku, fnsku, asin, iwasku,
        product_name, condition, available_quantity, qty_with_removals_in_progress,
        inv_age_0_to_90_days, inv_age_91_to_180_days, inv_age_181_to_270_days,
        inv_age_271_to_365_days, inv_age_365_plus_days,
        currency, estimated_ltsf_next_charge, per_unit_volume, is_hazmat, in_date,
        units_shipped_last_7_days, units_shipped_last_30_days,
        units_shipped_last_60_days, units_shipped_last_90_days,
        recommended_removal_quantity, estimated_ltsf_6_mo, estimated_ltsf_12_mo,
        alert, your_price, sales_price, sell_through, storage_type,
        recommended_action, estimated_cost_savings, healthy_inventory_level,
        last_synced_at
      ) VALUES ${values.join(', ')}
    `, params);
  }
}

async function createSyncJob(jobType: string, marketplace: string): Promise<number> {
  const result = await pool.query(
    'INSERT INTO sync_jobs (job_type, marketplace, status) VALUES ($1, $2, $3) RETURNING id',
    [jobType, marketplace, 'pending']
  );
  return result.rows[0].id;
}

async function updateSyncJob(
  id: number,
  status: string,
  recordsProcessed?: number,
  errorMessage?: string
): Promise<void> {
  const fields = ['status = $2'];
  const params: any[] = [id, status];
  let idx = 3;

  if (status === 'running') {
    fields.push(`started_at = NOW()`);
  }
  if (status === 'completed' || status === 'failed') {
    fields.push(`completed_at = NOW()`);
  }
  if (recordsProcessed !== undefined) {
    fields.push(`records_processed = $${idx}`);
    params.push(recordsProcessed);
    idx++;
  }
  if (errorMessage) {
    fields.push(`error_message = $${idx}`);
    params.push(errorMessage);
    idx++;
  }

  await pool.query(`UPDATE sync_jobs SET ${fields.join(', ')} WHERE id = $1`, params);
}

import { pool } from '../../config/database';
import { fetchFbaInventory } from '../spApi/inventory';
import { mapBulkSkusToIwasku } from '../skuMapper';
import logger from '../../config/logger';
import type { MarketplaceConfig, FbaInventoryItem } from '../../types';

export async function syncInventoryForMarketplace(marketplace: MarketplaceConfig): Promise<number> {
  const jobId = await createSyncJob('inventory_sync', marketplace.country_code);

  try {
    await updateSyncJob(jobId, 'running');

    // 1. Fetch from SP-API
    const items = await fetchFbaInventory(marketplace);
    if (items.length === 0) {
      await updateSyncJob(jobId, 'completed', 0);
      return 0;
    }

    // 2. Map SKUs to iwasku
    const skuMappings = await mapBulkSkusToIwasku(
      items.map(i => ({ sku: i.sku, countryCode: marketplace.country_code }))
    );

    for (const item of items) {
      item.iwasku = skuMappings.get(item.sku) || null;
    }

    // 3. Upsert into fba_inventory
    await upsertInventory(marketplace.warehouse, items);

    await updateSyncJob(jobId, 'completed', items.length);
    logger.info(`[Sync] Inventory sync completed for ${marketplace.country_code}: ${items.length} items`);
    return items.length;
  } catch (err: any) {
    logger.error(`[Sync] Inventory sync failed for ${marketplace.country_code}:`, err.message);
    await updateSyncJob(jobId, 'failed', 0, err.message);
    throw err;
  }
}

async function upsertInventory(warehouse: string, items: FbaInventoryItem[]): Promise<void> {
  const BATCH_SIZE = 500;

  // Delete existing inventory for this warehouse
  await pool.query('DELETE FROM fba_inventory WHERE warehouse = $1', [warehouse]);

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const values: string[] = [];
    const params: any[] = [];

    batch.forEach((item, idx) => {
      const offset = idx * 18;
      const placeholders = Array.from({ length: 18 }, (_, j) => `$${offset + j + 1}`);
      values.push(`(${placeholders.join(', ')})`);
      params.push(
        item.warehouse,
        item.marketplace_id,
        item.sku,
        item.asin,
        item.fnsku,
        item.iwasku,
        item.fulfillable_quantity,
        item.total_reserved_quantity,
        item.pending_customer_order_quantity,
        item.pending_transshipment_quantity,
        item.fc_processing_quantity,
        item.total_unfulfillable_quantity,
        item.customer_damaged_quantity,
        item.warehouse_damaged_quantity,
        item.distributor_damaged_quantity,
        item.inbound_shipped_quantity,
        item.inbound_working_quantity,
        item.inbound_receiving_quantity,
      );
    });

    await pool.query(`
      INSERT INTO fba_inventory (
        warehouse, marketplace_id, sku, asin, fnsku, iwasku,
        fulfillable_quantity, total_reserved_quantity,
        pending_customer_order_quantity, pending_transshipment_quantity,
        fc_processing_quantity, total_unfulfillable_quantity,
        customer_damaged_quantity, warehouse_damaged_quantity,
        distributor_damaged_quantity, inbound_shipped_quantity,
        inbound_working_quantity, inbound_receiving_quantity
      ) VALUES ${values.join(', ')}
      ON CONFLICT (warehouse, sku) DO UPDATE SET
        marketplace_id = EXCLUDED.marketplace_id,
        asin = EXCLUDED.asin,
        fnsku = EXCLUDED.fnsku,
        iwasku = EXCLUDED.iwasku,
        fulfillable_quantity = EXCLUDED.fulfillable_quantity,
        total_reserved_quantity = EXCLUDED.total_reserved_quantity,
        pending_customer_order_quantity = EXCLUDED.pending_customer_order_quantity,
        pending_transshipment_quantity = EXCLUDED.pending_transshipment_quantity,
        fc_processing_quantity = EXCLUDED.fc_processing_quantity,
        total_unfulfillable_quantity = EXCLUDED.total_unfulfillable_quantity,
        customer_damaged_quantity = EXCLUDED.customer_damaged_quantity,
        warehouse_damaged_quantity = EXCLUDED.warehouse_damaged_quantity,
        distributor_damaged_quantity = EXCLUDED.distributor_damaged_quantity,
        inbound_shipped_quantity = EXCLUDED.inbound_shipped_quantity,
        inbound_working_quantity = EXCLUDED.inbound_working_quantity,
        inbound_receiving_quantity = EXCLUDED.inbound_receiving_quantity,
        last_synced_at = NOW()
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

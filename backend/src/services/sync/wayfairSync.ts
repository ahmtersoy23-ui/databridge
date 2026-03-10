import { pool, sharedPool } from '../../config/database';
import { fetchWayfairInventory } from '../wayfair/inventory';
import logger from '../../config/logger';

const BATCH_SIZE = 500;

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
  const params: unknown[] = [id, status];
  let idx = 3;

  if (status === 'running') fields.push('started_at = NOW()');
  if (status === 'completed' || status === 'failed') fields.push('completed_at = NOW()');
  if (recordsProcessed !== undefined) {
    fields.push(`records_processed = $${idx}`);
    params.push(recordsProcessed);
    idx++;
  }
  if (errorMessage) {
    fields.push(`error_message = $${idx}`);
    params.push(errorMessage);
  }

  await pool.query(`UPDATE sync_jobs SET ${fields.join(', ')} WHERE id = $1`, params);
}

async function loadMappings(): Promise<Map<string, string>> {
  const result = await pool.query(
    'SELECT part_number, iwasku FROM wayfair_sku_mapping'
  );
  return new Map(result.rows.map((r: { part_number: string; iwasku: string }) => [r.part_number, r.iwasku]));
}

async function upsertInventory(
  items: Array<{ partNumber: string; warehouseId: string; warehouseName: string; quantity: number; iwasku: string | null }>
): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const values: string[] = [];
    const params: unknown[] = [];

    batch.forEach((item, idx) => {
      const offset = idx * 5;
      values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`);
      params.push(item.partNumber, item.warehouseId, item.warehouseName, item.quantity, item.iwasku);
    });

    await pool.query(`
      INSERT INTO wayfair_inventory (part_number, warehouse_id, warehouse_name, quantity, iwasku)
      VALUES ${values.join(', ')}
      ON CONFLICT (part_number, warehouse_id) DO UPDATE SET
        warehouse_name = EXCLUDED.warehouse_name,
        quantity = EXCLUDED.quantity,
        iwasku = EXCLUDED.iwasku,
        last_synced_at = NOW()
    `, params);
  }
}

async function aggregateToFbaInventory(): Promise<number> {
  // Remove stale WF rows before re-inserting fresh data
  await sharedPool.query(`DELETE FROM fba_inventory WHERE warehouse = 'WF'`);

  // Aggregate wayfair_inventory → fba_inventory (only mapped iwasku rows)
  const result = await pool.query(`
    SELECT iwasku, SUM(quantity)::int AS fulfillable_quantity
    FROM wayfair_inventory
    WHERE iwasku IS NOT NULL
    GROUP BY iwasku
  `);

  if (result.rows.length === 0) return 0;

  const values: string[] = [];
  const params: unknown[] = [];

  result.rows.forEach((row: { iwasku: string; fulfillable_quantity: number }, idx: number) => {
    const offset = idx * 4;
    values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`);
    params.push(
      row.iwasku,
      'WF',
      row.fulfillable_quantity,
      row.fulfillable_quantity // total_quantity = fulfillable for Wayfair
    );
  });

  await sharedPool.query(`
    INSERT INTO fba_inventory (iwasku, warehouse, fulfillable_quantity, total_quantity)
    VALUES ${values.join(', ')}
    ON CONFLICT (iwasku, warehouse) DO UPDATE SET
      fulfillable_quantity = EXCLUDED.fulfillable_quantity,
      total_quantity = EXCLUDED.total_quantity,
      updated_at = NOW()
  `, params);

  return result.rows.length;
}

export async function syncWayfair(): Promise<number> {
  const jobId = await createSyncJob('wayfair_sync', 'WAYFAIR');

  try {
    await updateSyncJob(jobId, 'running');

    // 1. Fetch inventory from CastleGate API
    const rawItems = await fetchWayfairInventory();
    logger.info(`[WayfairSync] Fetched ${rawItems.length} inventory items`);

    if (rawItems.length === 0) {
      await updateSyncJob(jobId, 'completed', 0);
      return 0;
    }

    // 2. Load user-managed mappings
    const mappings = await loadMappings();
    logger.info(`[WayfairSync] Loaded ${mappings.size} part_number → iwasku mappings`);

    // 3. Assign iwasku from mapping
    const enriched = rawItems.map(item => ({
      ...item,
      iwasku: mappings.get(item.partNumber) || null,
    }));

    const matched = enriched.filter(i => i.iwasku !== null).length;
    logger.info(`[WayfairSync] ${matched}/${enriched.length} items have iwasku mapping`);

    // 4. Upsert into wayfair_inventory (DataBridge internal)
    await upsertInventory(enriched);

    // 5. Aggregate to pricelab_db.fba_inventory (warehouse='WF')
    const aggregated = await aggregateToFbaInventory();
    logger.info(`[WayfairSync] Aggregated ${aggregated} iwasku rows to fba_inventory (WF)`);

    await updateSyncJob(jobId, 'completed', rawItems.length);
    logger.info(`[WayfairSync] Completed: ${rawItems.length} items, ${aggregated} mapped to StockPulse`);
    return rawItems.length;
  } catch (err: any) {
    logger.error('[WayfairSync] Failed:', err.message);
    await updateSyncJob(jobId, 'failed', 0, err.message);
    throw err;
  }
}

/**
 * Refresh WF aggregation from existing wayfair_inventory data (no API call).
 * Call this after mapping changes to immediately reflect updates in StockPulse.
 */
export async function refreshWayfairAggregation(): Promise<number> {
  const count = await aggregateToFbaInventory();
  logger.info(`[WayfairSync] Aggregation refresh: ${count} iwasku rows written to fba_inventory (WF)`);
  return count;
}

import { pool, sharedPool } from '../../config/database';
import { fetchWayfairInventory } from '../wayfair/inventory';
import { fetchWayfairPurchaseOrders } from '../wayfair/purchaseOrders';
import { fetchDropshipOrders } from '../wayfair/dropshipOrders';
import { getActiveAccounts, type WayfairAccount } from '../wayfair/client';
import { writeWayfairSalesData } from './wayfairSalesDataWriter';
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
  accountId: number,
  items: Array<{ partNumber: string; warehouseId: string; warehouseName: string; quantity: number; availableQty: number; iwasku: string | null }>
): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const values: string[] = [];
    const params: unknown[] = [];

    batch.forEach((item, idx) => {
      const offset = idx * 7;
      values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`);
      params.push(accountId, item.partNumber, item.warehouseId, item.warehouseName, item.quantity, item.availableQty, item.iwasku);
    });

    await pool.query(`
      INSERT INTO wayfair_inventory (account_id, part_number, warehouse_id, warehouse_name, quantity, available_qty, iwasku)
      VALUES ${values.join(', ')}
      ON CONFLICT (account_id, part_number, warehouse_id) DO UPDATE SET
        warehouse_name = EXCLUDED.warehouse_name,
        quantity = EXCLUDED.quantity,
        available_qty = EXCLUDED.available_qty,
        iwasku = EXCLUDED.iwasku,
        last_synced_at = NOW()
    `, params);
  }
}

async function getLastOrderDate(accountId: number): Promise<string | undefined> {
  const result = await pool.query(
    `SELECT MAX(po_date) as last_date FROM wayfair_orders WHERE account_id = $1`,
    [accountId]
  );
  const d = result.rows[0]?.last_date;
  return d ? new Date(d).toISOString() : undefined;
}

async function syncOrders(account: WayfairAccount, mappings: Map<string, string>): Promise<number> {
  let totalUpserted = 0;

  try {
    // Fetch from last known order date (incremental)
    const fromDate = await getLastOrderDate(account.id);

    const [cgOrders, dsOrders] = await Promise.all([
      fetchWayfairPurchaseOrders(account, fromDate),
      fetchDropshipOrders(account, fromDate),
    ]);

    const rows: Array<{
      po_number: string; po_date: string | null; supplier_id: number | null;
      order_type: string; part_number: string; iwasku: string | null;
      quantity: number; price: number; total_cost: number | null;
    }> = [];

    for (const o of cgOrders) {
      for (const p of o.products || []) {
        rows.push({
          po_number: o.poNumber, po_date: o.poDate, supplier_id: o.supplierId,
          order_type: 'castlegate', part_number: p.partNumber,
          iwasku: mappings.get(p.partNumber) || null,
          quantity: Number(p.quantity) || 0, price: Number(p.price) || 0,
          total_cost: p.totalCost != null ? Number(p.totalCost) : null,
        });
      }
    }
    for (const o of dsOrders) {
      for (const p of o.products || []) {
        rows.push({
          po_number: o.poNumber, po_date: o.poDate, supplier_id: o.supplierId,
          order_type: 'dropship', part_number: p.partNumber,
          iwasku: mappings.get(p.partNumber) || null,
          quantity: Number(p.quantity) || 0, price: Number(p.price) || 0,
          total_cost: null,
        });
      }
    }

    // Deduplicate by (po_number, part_number, order_type)
    const deduped = new Map<string, typeof rows[number]>();
    for (const r of rows) {
      const key = `${r.po_number}|${r.part_number}|${r.order_type}`;
      const existing = deduped.get(key);
      if (existing) {
        existing.quantity += r.quantity;
        existing.price = r.price;
        existing.total_cost =
          existing.total_cost != null && r.total_cost != null
            ? existing.total_cost + r.total_cost
            : r.total_cost ?? existing.total_cost;
      } else {
        deduped.set(key, { ...r });
      }
    }
    const uniqueRows = [...deduped.values()];

    for (let i = 0; i < uniqueRows.length; i += BATCH_SIZE) {
      const batch = uniqueRows.slice(i, i + BATCH_SIZE);
      const values: string[] = [];
      const params: unknown[] = [];

      batch.forEach((r, idx) => {
        const o = idx * 10;
        values.push(`($${o+1}, $${o+2}, $${o+3}, $${o+4}, $${o+5}, $${o+6}, $${o+7}, $${o+8}, $${o+9}, $${o+10})`);
        params.push(account.id, r.po_number, r.po_date, r.supplier_id, r.order_type, r.part_number, r.iwasku, r.quantity, r.price, r.total_cost);
      });

      await pool.query(`
        INSERT INTO wayfair_orders (account_id, po_number, po_date, supplier_id, order_type, part_number, iwasku, quantity, price, total_cost)
        VALUES ${values.join(', ')}
        ON CONFLICT (account_id, po_number, part_number, order_type) DO UPDATE SET
          po_date = EXCLUDED.po_date,
          supplier_id = EXCLUDED.supplier_id,
          iwasku = EXCLUDED.iwasku,
          quantity = EXCLUDED.quantity,
          price = EXCLUDED.price,
          total_cost = EXCLUDED.total_cost,
          fetched_at = NOW()
      `, params);

      totalUpserted += batch.length;
    }

    logger.info(`[WayfairSync][${account.label}] Upserted ${totalUpserted} order lines (${cgOrders.length} CG + ${dsOrders.length} DS, ${rows.length - uniqueRows.length} dupes merged)`);
  } catch (err: any) {
    logger.warn(`[WayfairSync][${account.label}] Order sync failed (non-fatal): ${err.message}`);
  }

  return totalUpserted;
}

async function aggregateToFbaInventory(account: WayfairAccount): Promise<number> {
  const result = await pool.query(`
    SELECT iwasku,
           SUM(quantity)::int AS fulfillable_quantity,
           (array_agg(part_number ORDER BY quantity DESC))[1] AS part_number
    FROM wayfair_inventory
    WHERE iwasku IS NOT NULL AND account_id = $1
    GROUP BY iwasku
  `, [account.id]);

  if (result.rows.length === 0) return 0;

  const client = await sharedPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM fba_inventory WHERE warehouse = $1', [account.warehouse]);

    for (let i = 0; i < result.rows.length; i += BATCH_SIZE) {
      const batch = result.rows.slice(i, i + BATCH_SIZE);
      const values: string[] = [];
      const params: unknown[] = [];

      batch.forEach((row: { iwasku: string; fulfillable_quantity: number; part_number: string | null }, idx: number) => {
        const offset = idx * 5;
        values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`);
        params.push(row.iwasku, account.warehouse, row.fulfillable_quantity, row.fulfillable_quantity, row.part_number || null);
      });

      await client.query(`
        INSERT INTO fba_inventory (iwasku, warehouse, fulfillable_quantity, total_quantity, asin)
        VALUES ${values.join(', ')}
        ON CONFLICT (iwasku, warehouse) DO UPDATE SET
          fulfillable_quantity = EXCLUDED.fulfillable_quantity,
          total_quantity = EXCLUDED.total_quantity,
          asin = EXCLUDED.asin,
          updated_at = NOW()
      `, params);
    }

    await client.query('COMMIT');
    return result.rows.length;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Sync a single Wayfair account (inventory + orders + aggregation) */
export async function syncWayfairAccount(account: WayfairAccount): Promise<number> {
  const jobId = await createSyncJob('wayfair_sync', `WF_${account.label.toUpperCase()}`);

  try {
    await updateSyncJob(jobId, 'running');

    const mappings = await loadMappings();
    let inventoryCount = 0;

    // 1. Inventory (non-fatal — some accounts may not have CG inventory access)
    try {
      const rawItems = await fetchWayfairInventory(account);
      logger.info(`[WayfairSync][${account.label}] Fetched ${rawItems.length} inventory items`);

      if (rawItems.length > 0) {
        const enriched = rawItems.map(item => ({
          ...item,
          iwasku: mappings.get(item.partNumber) || null,
        }));

        const matched = enriched.filter(i => i.iwasku !== null).length;
        logger.info(`[WayfairSync][${account.label}] ${matched}/${enriched.length} items have iwasku mapping`);

        await upsertInventory(account.id, enriched);
        inventoryCount = rawItems.length;

        const aggregated = await aggregateToFbaInventory(account);
        logger.info(`[WayfairSync][${account.label}] Aggregated ${aggregated} rows to fba_inventory (${account.warehouse})`);
      }
    } catch (err: any) {
      logger.warn(`[WayfairSync][${account.label}] Inventory sync skipped: ${err.message}`);
    }

    // 2. Orders (CG + Dropship)
    const orderLines = await syncOrders(account, mappings);

    // 3. Sales data aggregation
    const salesRows = await writeWayfairSalesData(account);
    logger.info(`[WayfairSync][${account.label}] Wrote ${salesRows} sales_data rows (channel=${account.channel})`);

    await updateSyncJob(jobId, 'completed', inventoryCount + orderLines);
    logger.info(`[WayfairSync][${account.label}] Completed: ${inventoryCount} inv + ${orderLines} orders`);
    return inventoryCount;
  } catch (err: any) {
    logger.error(`[WayfairSync][${account.label}] Failed: ${err.message}`);
    await updateSyncJob(jobId, 'failed', 0, err.message);
    throw err;
  }
}

/** Sync all active Wayfair accounts */
export async function syncWayfair(): Promise<void> {
  const accounts = await getActiveAccounts();
  if (accounts.length === 0) {
    logger.info('[WayfairSync] No active Wayfair accounts configured');
    return;
  }

  for (const account of accounts) {
    try {
      await syncWayfairAccount(account);
    } catch (err: any) {
      logger.error(`[WayfairSync] Account '${account.label}' failed: ${err.message}`);
      // Continue to next account
    }
  }
}

/** Refresh aggregation for all active accounts (no API call) */
export async function refreshWayfairAggregation(): Promise<number> {
  const accounts = await getActiveAccounts();
  let total = 0;
  for (const account of accounts) {
    const count = await aggregateToFbaInventory(account);
    logger.info(`[WayfairSync] Aggregation refresh [${account.label}]: ${count} rows → fba_inventory (${account.warehouse})`);
    total += count;
  }
  return total;
}

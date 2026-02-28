import { pool } from '../../config/database';
import { fetchOrdersByDateRange } from '../spApi/orders';
import { mapBulkSkusToIwasku } from '../skuMapper';
import logger from '../../config/logger';
import { SALES_OVERLAP_DAYS } from '../../config/constants';
import type { MarketplaceConfig, RawOrder } from '../../types';

export async function syncSalesForMarketplace(
  marketplace: MarketplaceConfig,
  daysBack: number = SALES_OVERLAP_DAYS
): Promise<number> {
  const jobId = await createSyncJob('sales_sync', marketplace.country_code);

  try {
    await updateSyncJob(jobId, 'running');

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    // 1. Fetch orders from SP-API
    const orders = await fetchOrdersByDateRange(marketplace, startDate, endDate);
    if (orders.length === 0) {
      await updateSyncJob(jobId, 'completed', 0);
      return 0;
    }

    // 2. Map SKUs to iwasku
    const skuMappings = await mapBulkSkusToIwasku(
      orders.map(o => ({ sku: o.sku, countryCode: marketplace.country_code }))
    );

    for (const order of orders) {
      order.iwasku = skuMappings.get(order.sku) || null;
    }

    // 3. Upsert into raw_orders
    await upsertOrders(orders);

    await updateSyncJob(jobId, 'completed', orders.length);
    logger.info(`[Sync] Sales sync completed for ${marketplace.country_code}: ${orders.length} orders`);
    return orders.length;
  } catch (err: any) {
    logger.error(`[Sync] Sales sync failed for ${marketplace.country_code}:`, err.message);
    await updateSyncJob(jobId, 'failed', 0, err.message);
    throw err;
  }
}

export async function backfillSales(marketplace: MarketplaceConfig, months: number = 13): Promise<number> {
  logger.info(`[Sync] Starting sales backfill for ${marketplace.country_code}: ${months} months`);

  let totalOrders = 0;
  const now = new Date();

  // Process month by month to avoid huge report requests
  for (let m = 0; m < months; m++) {
    const endDate = new Date(now);
    endDate.setMonth(endDate.getMonth() - m);

    const startDate = new Date(endDate);
    startDate.setMonth(startDate.getMonth() - 1);

    try {
      const count = await syncSalesForMarketplace(marketplace, 30);
      totalOrders += count;
      logger.info(`[Sync] Backfill month ${m + 1}/${months} for ${marketplace.country_code}: ${count} orders`);

      // Respect rate limits between months
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (err: any) {
      logger.error(`[Sync] Backfill month ${m + 1} failed for ${marketplace.country_code}:`, err.message);
    }
  }

  return totalOrders;
}

async function upsertOrders(orders: RawOrder[]): Promise<void> {
  const BATCH_SIZE = 500;

  for (let i = 0; i < orders.length; i += BATCH_SIZE) {
    const batch = orders.slice(i, i + BATCH_SIZE);
    const values: string[] = [];
    const params: any[] = [];

    batch.forEach((order, idx) => {
      const offset = idx * 14;
      const placeholders = Array.from({ length: 14 }, (_, j) => `$${offset + j + 1}`);
      values.push(`(${placeholders.join(', ')})`);
      params.push(
        order.marketplace_id,
        order.channel,
        order.amazon_order_id,
        order.purchase_date,
        order.purchase_date_local,
        order.sku,
        order.asin,
        order.iwasku,
        order.quantity,
        order.item_price,
        order.currency,
        order.order_status,
        order.fulfillment_channel,
        new Date(),
      );
    });

    await pool.query(`
      INSERT INTO raw_orders (
        marketplace_id, channel, amazon_order_id, purchase_date,
        purchase_date_local, sku, asin, iwasku, quantity, item_price,
        currency, order_status, fulfillment_channel, created_at
      ) VALUES ${values.join(', ')}
      ON CONFLICT (amazon_order_id, sku) DO UPDATE SET
        iwasku = EXCLUDED.iwasku,
        quantity = EXCLUDED.quantity,
        item_price = EXCLUDED.item_price,
        order_status = EXCLUDED.order_status
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
    idx++;
  }

  await pool.query(`UPDATE sync_jobs SET ${fields.join(', ')} WHERE id = $1`, params);
}

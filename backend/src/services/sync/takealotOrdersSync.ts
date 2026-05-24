import { pool, sharedPool } from '../../config/database';
import logger from '../../config/logger';
import { notify } from '../../utils/notify';
import { getActiveAccounts, type TakealotAccount } from '../takealot/client';
import { fetchOrders, type TakealotParsedOrderLine } from '../takealot/orders';
import { fetchOffers, type TakealotParsedInventoryRow } from '../takealot/inventory';
import { writeTakealotSalesData } from './takealotSalesDataWriter';
import { getSafetyDropThreshold } from '../../utils/safetyThreshold';

export const TAKEALOT_ROLLING_DAYS = 30;

function dateNDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function resolveIwaskuMap(skus: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (skus.length === 0) return map;

  const overrideRes = await pool.query<{ sku: string; iwasku: string }>(
    'SELECT sku, iwasku FROM takealot_sku_mapping WHERE sku = ANY($1)',
    [skus],
  );
  for (const row of overrideRes.rows) map.set(row.sku, row.iwasku);

  const missing = skus.filter(s => !map.has(s));
  if (missing.length === 0) return map;

  const smRes = await sharedPool.query<{ lookup_key: string; iwasku: string }>(
    `SELECT DISTINCT ON (lookup_key) lookup_key, iwasku FROM (
       SELECT sku    AS lookup_key, iwasku, marketplace, 1 AS priority
         FROM sku_master WHERE iwasku IS NOT NULL AND sku = ANY($1)
       UNION ALL
       SELECT asin   AS lookup_key, iwasku, marketplace, 2 AS priority
         FROM sku_master WHERE iwasku IS NOT NULL AND asin = ANY($1)
       UNION ALL
       SELECT fnsku  AS lookup_key, iwasku, marketplace, 3 AS priority
         FROM sku_master WHERE iwasku IS NOT NULL AND fnsku = ANY($1)
       UNION ALL
       SELECT iwasku AS lookup_key, iwasku, marketplace, 4 AS priority
         FROM sku_master WHERE iwasku IS NOT NULL AND iwasku = ANY($1)
       UNION ALL
       SELECT product_sku AS lookup_key, product_sku AS iwasku, 'catalog' AS marketplace, 5 AS priority
         FROM products WHERE product_sku IS NOT NULL AND product_sku = ANY($1)
     ) u
     ORDER BY lookup_key, priority, (marketplace = 'takealot') DESC, marketplace`,
    [missing],
  );
  for (const row of smRes.rows) map.set(row.lookup_key, row.iwasku);

  return map;
}

async function upsertOrderLines(
  rows: TakealotParsedOrderLine[],
  iwaskuMap: Map<string, string>,
): Promise<number> {
  if (rows.length === 0) return 0;

  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    chunk.forEach((row, idx) => {
      const base = idx * 16;
      placeholders.push(
        `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},` +
        `$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},` +
        `$${base + 13},$${base + 14},$${base + 15},$${base + 16})`,
      );
      values.push(
        row.order_id,
        row.order_item_id,
        row.order_date,
        row.order_date_local,
        row.sku,
        row.tsin,
        row.sku ? (iwaskuMap.get(row.sku) ?? null) : null,
        row.product_title,
        row.quantity,
        row.selling_price,
        row.item_price,
        row.dc,
        row.customer_dc,
        row.sale_status,
        row.promotion,
        row.stock_source_region,
      );
    });

    const sql = `
      INSERT INTO takealot_raw_orders (
        order_id, order_item_id, order_date, order_date_local, sku, tsin, iwasku,
        product_title, quantity, selling_price, item_price, dc, customer_dc,
        sale_status, promotion, stock_source_region
      )
      VALUES ${placeholders.join(',')}
      ON CONFLICT (order_item_id) DO UPDATE SET
        quantity = EXCLUDED.quantity,
        selling_price = EXCLUDED.selling_price,
        item_price = EXCLUDED.item_price,
        dc = EXCLUDED.dc,
        customer_dc = EXCLUDED.customer_dc,
        sale_status = EXCLUDED.sale_status,
        iwasku = COALESCE(EXCLUDED.iwasku, takealot_raw_orders.iwasku)
    `;
    const result = await pool.query(sql, values);
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

async function upsertInventory(
  rows: TakealotParsedInventoryRow[],
  iwaskuMap: Map<string, string>,
): Promise<number> {
  if (rows.length === 0) return 0;

  // For inventory, simpler approach: delete all and re-insert (snapshot model)
  // Use DELETE not TRUNCATE — TRUNCATE RESTART IDENTITY requires sequence ownership.
  await pool.query('DELETE FROM takealot_inventory');

  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    chunk.forEach((row, idx) => {
      const base = idx * 11;
      placeholders.push(
        `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},` +
        `$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11})`,
      );
      values.push(
        row.offer_id,
        row.sku,
        row.tsin,
        row.sku ? (iwaskuMap.get(row.sku) ?? null) : null,
        row.product_title,
        row.selling_price,
        row.status,
        row.stock_at_takealot_total,
        row.total_stock_on_way,
        row.total_stock_cover,
        row.leadtime_days,
      );
    });

    const sql = `
      INSERT INTO takealot_inventory (
        offer_id, sku, tsin, iwasku, product_title, selling_price, status,
        stock_at_takealot_total, total_stock_on_way, total_stock_cover, leadtime_days
      )
      VALUES ${placeholders.join(',')}
    `;
    const result = await pool.query(sql, values);
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

export async function syncTakealotForAccount(
  account: TakealotAccount,
  days: number = TAKEALOT_ROLLING_DAYS,
): Promise<number> {
  const startDate = dateNDaysAgo(days);
  const endDate = todayUtc();

  logger.info(`[Takealot] '${account.label}' fetching sales ${startDate} → ${endDate}`);
  const orderRows = await fetchOrders(account, { startDate, endDate });

  logger.info(`[Takealot] '${account.label}' fetching offers (inventory)...`);
  const inventoryRows = await fetchOffers(account);

  // Collect unique SKUs across both for iwasku resolve
  const skuSet = new Set<string>();
  for (const r of orderRows) if (r.sku) skuSet.add(r.sku);
  for (const r of inventoryRows) if (r.sku) skuSet.add(r.sku);
  const iwaskuMap = await resolveIwaskuMap([...skuSet]);
  logger.info(
    `[Takealot] '${account.label}' resolved ${iwaskuMap.size}/${skuSet.size} SKUs to iwasku`,
  );

  // Safety threshold for orders
  if (orderRows.length > 0) {
    const existing = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM takealot_raw_orders
       WHERE order_date_local >= $1::date`,
      [startDate],
    );
    const existingCount = parseInt(existing.rows[0].cnt, 10);
    const threshold = getSafetyDropThreshold('TAKEALOT_ORDERS');
    if (existingCount > 10 && orderRows.length < existingCount * threshold) {
      const msg = `[Takealot] '${account.label}' ORDERS SKIPPED — ` +
        `fetched ${orderRows.length} vs ${existingCount} existing (threshold ${threshold})`;
      logger.error(msg);
      await notify(`⚠️ ${msg}`);
    } else {
      const upserted = await upsertOrderLines(orderRows, iwaskuMap);
      logger.info(`[Takealot] '${account.label}' upserted ${upserted} order lines`);
    }
  }

  // Inventory snapshot — always replace
  const invCount = await upsertInventory(inventoryRows, iwaskuMap);
  logger.info(`[Takealot] '${account.label}' wrote ${invCount} inventory rows`);

  return orderRows.length;
}

export async function syncTakealot(days?: number): Promise<number> {
  const accounts = await getActiveAccounts();
  if (accounts.length === 0) {
    logger.info('[Takealot] No active accounts, skipping');
    return 0;
  }

  let total = 0;
  for (const account of accounts) {
    try {
      total += await syncTakealotForAccount(account, days);
    } catch (err: any) {
      logger.error(`[Takealot] '${account.label}' sync failed: ${err.message}`);
    }
  }

  // Aggregate raw_orders -> sales_data (channel='takealot')
  try {
    await writeTakealotSalesData();
  } catch (err: any) {
    logger.error(`[Takealot] writeTakealotSalesData failed: ${err.message}`);
  }

  return total;
}

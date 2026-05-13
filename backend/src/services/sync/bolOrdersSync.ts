import { pool, sharedPool } from '../../config/database';
import logger from '../../config/logger';
import { notify } from '../../utils/notify';
import { getActiveAccounts, type BolAccount } from '../bol/client';
import { fetchOrders, type BolParsedOrderLine } from '../bol/orders';
import { writeBolSalesData } from './bolSalesDataWriter';

// Rolling window — Bol allows max 3 months via latest-change-date.
// Default daily sync = 30 days (matches Walmart pattern).
export const BOL_ROLLING_DAYS = 30;
const BOL_MAX_HISTORY_DAYS = 90;  // Bol API hard limit

function dateNDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Resolve Bol SKU -> iwasku, mirroring Walmart pattern.
 * Bol seller SKU comes from offer.reference. Order: manual mapping > sku_master
 * (sku/asin/fnsku/iwasku columns) > products.product_sku.
 */
async function resolveIwaskuMap(skus: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (skus.length === 0) return map;

  // 1) Manual overrides
  const overrideRes = await pool.query<{ sku: string; iwasku: string }>(
    'SELECT sku, iwasku FROM bol_sku_mapping WHERE sku = ANY($1)',
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
     ORDER BY lookup_key, priority, (marketplace = 'bol') DESC, marketplace`,
    [missing],
  );
  for (const row of smRes.rows) map.set(row.lookup_key, row.iwasku);

  return map;
}

async function upsertOrderLines(
  rows: BolParsedOrderLine[],
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
      const base = idx * 13;
      placeholders.push(
        `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},` +
        `$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13})`,
      );
      values.push(
        row.account_id,
        row.order_id,
        row.order_item_id,
        row.order_placed_at,
        row.order_date_local,
        row.sku,
        row.sku ? (iwaskuMap.get(row.sku) ?? null) : null,
        row.ean,
        row.product_title,
        row.quantity,
        row.unit_price,
        row.item_price,
        row.fulfilment_method,
      );
    });

    const sql = `
      INSERT INTO bol_raw_orders (
        account_id, order_id, order_item_id, order_placed_at, order_date_local,
        sku, iwasku, ean, product_title, quantity, unit_price, item_price, fulfilment_method
      )
      VALUES ${placeholders.join(',')}
      ON CONFLICT (account_id, order_item_id) DO UPDATE SET
        quantity = EXCLUDED.quantity,
        unit_price = EXCLUDED.unit_price,
        item_price = EXCLUDED.item_price,
        fulfilment_method = EXCLUDED.fulfilment_method,
        iwasku = COALESCE(EXCLUDED.iwasku, bol_raw_orders.iwasku)
    `;

    const result = await pool.query(sql, values);
    inserted += result.rowCount ?? 0;
  }

  return inserted;
}

export async function syncBolOrdersForAccount(
  account: BolAccount,
  days: number = BOL_ROLLING_DAYS,
): Promise<number> {
  const cappedDays = Math.min(days, BOL_MAX_HISTORY_DAYS);
  const latestChangeDate = dateNDaysAgo(cappedDays);

  logger.info(
    `[Bol] '${account.label}' fetching orders since ${latestChangeDate} (${cappedDays} days)`
  );

  const rows = await fetchOrders(account, {
    status: 'ALL',
    fulfilmentMethod: 'FBR',
    latestChangeDate,
  });

  if (rows.length === 0) {
    logger.info(`[Bol] '${account.label}' no orders in window`);
    return 0;
  }

  // Safety threshold
  const existing = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM bol_raw_orders
     WHERE account_id = $1 AND order_date_local >= $2::date`,
    [account.id, latestChangeDate],
  );
  const existingCount = parseInt(existing.rows[0].cnt, 10);
  if (existingCount > 10 && rows.length < existingCount * 0.2) {
    const msg =
      `[Bol] '${account.label}' SKIPPED — fetched ${rows.length} items vs ` +
      `${existingCount} existing (>80% drop, safety threshold)`;
    logger.error(msg);
    await notify(`⚠️ ${msg}`);
    return 0;
  }

  const uniqueSkus = [...new Set(rows.map(r => r.sku).filter((s): s is string => !!s))];
  const iwaskuMap = await resolveIwaskuMap(uniqueSkus);
  const resolved = uniqueSkus.filter(s => iwaskuMap.has(s)).length;
  logger.info(
    `[Bol] '${account.label}' resolved ${resolved}/${uniqueSkus.length} SKUs to iwasku`
  );

  const inserted = await upsertOrderLines(rows, iwaskuMap);
  logger.info(
    `[Bol] '${account.label}' upserted ${inserted} order items (${rows.length} fetched)`
  );

  return inserted;
}

export async function syncBolOrders(days?: number): Promise<number> {
  const accounts = await getActiveAccounts();
  if (accounts.length === 0) {
    logger.info('[Bol] No active accounts, skipping');
    return 0;
  }

  let total = 0;
  for (const account of accounts) {
    try {
      total += await syncBolOrdersForAccount(account, days);
    } catch (err: any) {
      logger.error(`[Bol] '${account.label}' sync failed: ${err.message}`);
    }
  }

  // Aggregate raw_orders -> sales_data per account (channel='bol_<label>')
  for (const account of accounts) {
    try {
      await writeBolSalesData(account);
    } catch (err: any) {
      logger.error(`[Bol] writeBolSalesData '${account.label}' failed: ${err.message}`);
    }
  }

  return total;
}

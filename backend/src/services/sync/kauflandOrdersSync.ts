import { pool, sharedPool } from '../../config/database';
import logger from '../../config/logger';
import { notify } from '../../utils/notify';
import { getActiveAccounts, type KauflandAccount } from '../kaufland/client';
import { fetchOrdersWithUnits, type KauflandParsedOrderLine } from '../kaufland/orders';
import { fetchAllUnits, type ParsedUnit } from '../kaufland/inventory';
import { writeKauflandSalesData } from './kauflandSalesDataWriter';

export const KAUFLAND_ROLLING_DAYS = 30;

/**
 * Build the list of lookup keys for iwasku resolution: EAN, offer_sku, and id_product_unit.
 * All three are candidate columns where sku_master / products may have a match.
 */
function collectLookupKeys(rows: KauflandParsedOrderLine[]): string[] {
  const s = new Set<string>();
  for (const r of rows) {
    if (r.ean) s.add(r.ean);
    if (r.offer_sku) s.add(r.offer_sku);
    if (r.product_id_unit) s.add(r.product_id_unit);
  }
  return [...s];
}

function collectUnitKeys(rows: ParsedUnit[]): string[] {
  const s = new Set<string>();
  for (const r of rows) {
    if (r.ean) s.add(r.ean);
    if (r.offer_sku) s.add(r.offer_sku);
  }
  return [...s];
}

async function resolveIwaskuMap(
  accountId: number,
  keys: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (keys.length === 0) return map;

  // 1) Manual mapping (highest priority, per account)
  const overrideRes = await pool.query<{ marketplace_sku: string; iwasku: string }>(
    'SELECT marketplace_sku, iwasku FROM kaufland_sku_mapping WHERE account_id = $1 AND marketplace_sku = ANY($2)',
    [accountId, keys],
  );
  for (const row of overrideRes.rows) map.set(row.marketplace_sku, row.iwasku);

  const missing = keys.filter(k => !map.has(k));
  if (missing.length === 0) return map;

  // 2) Catalog UNION resolver (Walmart/Bol/Takealot pattern)
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
     ORDER BY lookup_key, priority, (marketplace = 'kaufland') DESC, marketplace`,
    [missing],
  );
  for (const row of smRes.rows) map.set(row.lookup_key, row.iwasku);

  return map;
}

function resolveIwasku(
  ean: string | null,
  offerSku: string | null,
  productIdUnit: string | null,
  map: Map<string, string>,
): string | null {
  if (offerSku && map.has(offerSku)) return map.get(offerSku)!;
  if (ean && map.has(ean)) return map.get(ean)!;
  if (productIdUnit && map.has(productIdUnit)) return map.get(productIdUnit)!;
  return null;
}

async function upsertOrderLines(
  account: KauflandAccount,
  rows: KauflandParsedOrderLine[],
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
        account.id,
        row.id_order,
        row.id_order_unit,
        row.storefront,
        row.order_date,
        row.order_date_local,
        row.ean,
        row.offer_sku,
        row.product_title,
        row.product_id_unit,
        resolveIwasku(row.ean, row.offer_sku, row.product_id_unit, iwaskuMap),
        row.quantity,
        row.unit_price,
        row.item_price,
        row.currency,
        row.status,
      );
    });

    const sql = `
      INSERT INTO kaufland_raw_orders (
        account_id, id_order, id_order_unit, storefront, order_date, order_date_local,
        ean, offer_sku, product_title, product_id_unit, iwasku,
        quantity, unit_price, item_price, currency, status
      )
      VALUES ${placeholders.join(',')}
      ON CONFLICT (id_order_unit) DO UPDATE SET
        quantity = EXCLUDED.quantity,
        unit_price = EXCLUDED.unit_price,
        item_price = EXCLUDED.item_price,
        status = EXCLUDED.status,
        is_cancelled = (EXCLUDED.status IS NOT NULL AND EXCLUDED.status ~* 'cancel'),
        iwasku = COALESCE(EXCLUDED.iwasku, kaufland_raw_orders.iwasku)
    `;
    const result = await pool.query(sql, values);
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

async function upsertInventory(
  account: KauflandAccount,
  rows: ParsedUnit[],
  iwaskuMap: Map<string, string>,
): Promise<number> {
  // Snapshot: clear this account's rows then re-insert.
  await pool.query('DELETE FROM kaufland_inventory WHERE account_id = $1', [account.id]);
  if (rows.length === 0) return 0;

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
        account.id,
        row.id_unit,
        row.ean,
        row.offer_sku,
        row.product_title,
        row.storefront,
        row.amount,
        row.reserved_amount,
        row.price,
        row.status,
        resolveIwasku(row.ean, row.offer_sku, null, iwaskuMap),
      );
    });
    const sql = `
      INSERT INTO kaufland_inventory (
        account_id, id_unit, ean, offer_sku, product_title, storefront,
        amount, reserved_amount, price, status, iwasku
      )
      VALUES ${placeholders.join(',')}
    `;
    const result = await pool.query(sql, values);
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

export async function syncKauflandForAccount(
  account: KauflandAccount,
  days: number = KAUFLAND_ROLLING_DAYS,
): Promise<number> {
  const tsFrom = Math.floor((Date.now() - days * 24 * 3600 * 1000) / 1000);
  logger.info(`[Kaufland] '${account.label}' fetching orders since ts=${tsFrom} (${days}d)`);

  const orderRows = await fetchOrdersWithUnits(account, { tsFrom });
  logger.info(`[Kaufland] '${account.label}' fetching units (inventory)...`);
  const inventoryRows = await fetchAllUnits(account);

  const orderKeys = collectLookupKeys(orderRows);
  const unitKeys = collectUnitKeys(inventoryRows);
  const iwaskuMap = await resolveIwaskuMap(account.id, [...new Set([...orderKeys, ...unitKeys])]);

  let orderResolved = 0;
  for (const r of orderRows) {
    if (resolveIwasku(r.ean, r.offer_sku, r.product_id_unit, iwaskuMap)) orderResolved++;
  }
  let invResolved = 0;
  for (const r of inventoryRows) {
    if (resolveIwasku(r.ean, r.offer_sku, null, iwaskuMap)) invResolved++;
  }
  logger.info(
    `[Kaufland] '${account.label}' iwasku resolved: ` +
    `orders ${orderResolved}/${orderRows.length}, inventory ${invResolved}/${inventoryRows.length}`,
  );

  // Safety: orders 80%+ drop block
  if (orderRows.length > 0) {
    const existing = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM kaufland_raw_orders
       WHERE account_id = $1 AND order_date_local >= (CURRENT_DATE - $2::int)`,
      [account.id, days],
    );
    const existingCount = parseInt(existing.rows[0].cnt, 10);
    if (existingCount > 10 && orderRows.length < existingCount * 0.2) {
      const msg = `[Kaufland] '${account.label}' ORDERS SKIPPED — ` +
        `fetched ${orderRows.length} vs ${existingCount} existing (>80% drop)`;
      logger.error(msg);
      await notify(`⚠️ ${msg}`);
    } else {
      const upserted = await upsertOrderLines(account, orderRows, iwaskuMap);
      logger.info(`[Kaufland] '${account.label}' upserted ${upserted} order lines`);
    }
  }

  const invCount = await upsertInventory(account, inventoryRows, iwaskuMap);
  logger.info(`[Kaufland] '${account.label}' wrote ${invCount} inventory rows`);

  return orderRows.length;
}

export async function syncKaufland(days?: number): Promise<number> {
  const accounts = await getActiveAccounts();
  if (accounts.length === 0) {
    logger.info('[Kaufland] No active accounts, skipping');
    return 0;
  }

  let total = 0;
  for (const account of accounts) {
    try {
      total += await syncKauflandForAccount(account, days);
    } catch (err: any) {
      logger.error(`[Kaufland] '${account.label}' sync failed: ${err.message}`);
    }
  }

  // Aggregate raw_orders -> sales_data per channel
  try {
    await writeKauflandSalesData();
  } catch (err: any) {
    logger.error(`[Kaufland] writeKauflandSalesData failed: ${err.message}`);
  }

  return total;
}

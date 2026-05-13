import { pool, sharedPool } from '../../config/database';
import logger from '../../config/logger';
import { notify } from '../../utils/notify';
import { getActiveAccounts, type WalmartAccount } from '../walmart/client';
import { fetchOrders, type WalmartParsedOrderLine } from '../walmart/orders';
import { writeWalmartSalesData } from './walmartSalesDataWriter';

// Rolling window — match user request (start with 30, expand later)
export const WALMART_ROLLING_DAYS = 30;

function dateNDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Resolve SKU -> iwasku using walmart_sku_mapping override first, then sku_master.product_sku. */
async function resolveIwaskuMap(skus: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (skus.length === 0) return map;

  // 1) Manual overrides
  const overrideRes = await pool.query<{ sku: string; iwasku: string }>(
    'SELECT sku, iwasku FROM walmart_sku_mapping WHERE sku = ANY($1)',
    [skus],
  );
  for (const row of overrideRes.rows) map.set(row.sku, row.iwasku);

  // Walmart seller'lar SKU alanina farkli sey koyabilir:
  //   - "B0..." = ASIN (Amazon listing'i Walmart'a aynen tasinmis — en yaygin)
  //   - "X00..." = FNSKU (Amazon FBA barkodu)
  //   - "AHM..." = iwasku'nun kendisi
  //   - Diger = seller'in kendi SKU'su
  // sku_master'da 4 sutunu (sku/asin/fnsku/iwasku) ariyoruz; eger sku_master'da
  // hic kayit yoksa (urun hicbir marketplace'te listelenmemis), `products` katalogundan
  // dogrudan product_sku ile dusuruyoruz. Tek UNION query.
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
     ORDER BY lookup_key, priority, (marketplace = 'walmart') DESC, marketplace`,
    [missing],
  );
  for (const row of smRes.rows) map.set(row.lookup_key, row.iwasku);

  return map;
}

async function upsertOrderLines(
  rows: WalmartParsedOrderLine[],
  iwaskuMap: Map<string, string>,
): Promise<number> {
  if (rows.length === 0) return 0;

  // Batch insert in chunks of 500 to keep params under PostgreSQL's $65535 limit
  const CHUNK = 500;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const placeholders: string[] = [];

    chunk.forEach((row, idx) => {
      const base = idx * 18;
      placeholders.push(
        `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},` +
        `$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},` +
        `$${base + 13},$${base + 14},$${base + 15},$${base + 16},$${base + 17},$${base + 18})`
      );
      values.push(
        row.customer_order_id,
        row.purchase_order_id,
        row.order_date,
        row.order_date_local,
        row.line_number,
        row.sku,
        iwaskuMap.get(row.sku) ?? null,
        row.product_name,
        row.quantity,
        row.unit_price,
        row.item_price,
        row.currency,
        row.order_status,
        row.ship_node_type,
        row.customer_email_marketing,
        row.shipping_postal_code,
        row.shipping_state,
        row.shipping_country,
      );
    });

    const sql = `
      INSERT INTO walmart_raw_orders (
        customer_order_id, purchase_order_id, order_date, order_date_local,
        line_number, sku, iwasku, product_name, quantity, unit_price, item_price,
        currency, order_status, ship_node_type, customer_email_marketing,
        shipping_postal_code, shipping_state, shipping_country
      )
      VALUES ${placeholders.join(',')}
      ON CONFLICT (purchase_order_id, line_number) DO UPDATE SET
        order_status = EXCLUDED.order_status,
        ship_node_type = EXCLUDED.ship_node_type,
        quantity = EXCLUDED.quantity,
        unit_price = EXCLUDED.unit_price,
        item_price = EXCLUDED.item_price,
        iwasku = COALESCE(EXCLUDED.iwasku, walmart_raw_orders.iwasku)
    `;

    const result = await pool.query(sql, values);
    inserted += result.rowCount ?? 0;
  }

  return inserted;
}

export async function syncWalmartOrdersForAccount(
  account: WalmartAccount,
  days: number = WALMART_ROLLING_DAYS,
): Promise<number> {
  const startDate = dateNDaysAgo(days);
  const endDate = todayUtc();

  logger.info(
    `[Walmart] '${account.label}' fetching orders ${startDate} → ${endDate}`
  );

  const rows = await fetchOrders(account, {
    createdStartDate: startDate,
    createdEndDate: endDate,
    limit: 100,
  });

  if (rows.length === 0) {
    logger.info(`[Walmart] '${account.label}' no orders in window`);
    return 0;
  }

  // Safety threshold — guard against API returning a near-empty window
  // when there's already established data in DB
  const existing = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM walmart_raw_orders
     WHERE order_date_local >= $1::date`,
    [startDate],
  );
  const existingCount = parseInt(existing.rows[0].cnt, 10);
  if (existingCount > 10 && rows.length < existingCount * 0.2) {
    const msg =
      `[Walmart] '${account.label}' SKIPPED — fetched ${rows.length} lines vs ` +
      `${existingCount} existing (>80% drop, safety threshold)`;
    logger.error(msg);
    await notify(`⚠️ ${msg}`);
    return 0;
  }

  // Resolve iwasku for all unique SKUs in one batch
  const uniqueSkus = [...new Set(rows.map(r => r.sku))];
  const iwaskuMap = await resolveIwaskuMap(uniqueSkus);
  const resolved = uniqueSkus.filter(s => iwaskuMap.has(s)).length;
  logger.info(
    `[Walmart] '${account.label}' resolved ${resolved}/${uniqueSkus.length} SKUs to iwasku`
  );

  const inserted = await upsertOrderLines(rows, iwaskuMap);
  logger.info(
    `[Walmart] '${account.label}' upserted ${inserted} order lines (${rows.length} fetched)`
  );

  return inserted;
}

export async function syncWalmartOrders(days?: number): Promise<number> {
  const accounts = await getActiveAccounts();
  if (accounts.length === 0) {
    logger.info('[Walmart] No active accounts, skipping');
    return 0;
  }

  let total = 0;
  for (const account of accounts) {
    try {
      total += await syncWalmartOrdersForAccount(account, days);
    } catch (err: any) {
      logger.error(
        `[Walmart] '${account.label}' sync failed: ${err.message}`
      );
      // Continue with other accounts
    }
  }

  // Aggregate raw_orders -> sales_data (channel='walmart') for StockPulse consumption
  try {
    await writeWalmartSalesData();
  } catch (err: any) {
    logger.error(`[Walmart] writeWalmartSalesData failed: ${err.message}`);
  }

  return total;
}

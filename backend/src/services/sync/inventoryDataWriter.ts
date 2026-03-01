import { pool, sharedPool } from '../../config/database';
import logger from '../../config/logger';

const WAREHOUSES = ['US', 'UK', 'EU', 'CA', 'AU', 'AE', 'SA'];

const INVENTORY_SQL = `
  WITH deduped AS (
    SELECT DISTINCT ON (COALESCE(iwasku, sku), fnsku)
      COALESCE(iwasku, sku) as iwasku,
      asin, fnsku, sku,
      fulfillable_quantity, total_reserved_quantity,
      pending_customer_order_quantity, pending_transshipment_quantity,
      fc_processing_quantity, total_unfulfillable_quantity,
      customer_damaged_quantity, warehouse_damaged_quantity,
      distributor_damaged_quantity, inbound_shipped_quantity,
      inbound_working_quantity, inbound_receiving_quantity
    FROM fba_inventory
    WHERE warehouse = $1 AND sku NOT LIKE 'amzn.gr.%'
    ORDER BY COALESCE(iwasku, sku), fnsku, fulfillable_quantity DESC
  )
  SELECT
    iwasku,
    (array_agg(asin ORDER BY fulfillable_quantity DESC))[1] as asin,
    (array_agg(fnsku ORDER BY fulfillable_quantity DESC))[1] as fnsku,
    string_agg(DISTINCT sku, ', ') as sku_list,
    SUM(fulfillable_quantity)::int as fulfillable_quantity,
    SUM(total_reserved_quantity)::int as total_reserved_quantity,
    SUM(pending_customer_order_quantity)::int as pending_customer_order_quantity,
    SUM(pending_transshipment_quantity)::int as pending_transshipment_quantity,
    SUM(fc_processing_quantity)::int as fc_processing_quantity,
    SUM(total_unfulfillable_quantity)::int as total_unfulfillable_quantity,
    SUM(customer_damaged_quantity)::int as customer_damaged_quantity,
    SUM(warehouse_damaged_quantity)::int as warehouse_damaged_quantity,
    SUM(distributor_damaged_quantity)::int as distributor_damaged_quantity,
    SUM(inbound_shipped_quantity)::int as inbound_shipped_quantity,
    SUM(inbound_working_quantity)::int as inbound_working_quantity,
    SUM(inbound_receiving_quantity)::int as inbound_receiving_quantity,
    (SUM(fulfillable_quantity) + SUM(total_reserved_quantity) + SUM(total_unfulfillable_quantity)
     + SUM(inbound_shipped_quantity) + SUM(inbound_working_quantity) + SUM(inbound_receiving_quantity))::int as total_quantity
  FROM deduped
  GROUP BY iwasku
  ORDER BY iwasku
`;

interface InventoryRow {
  iwasku: string;
  asin: string;
  fnsku: string;
  sku_list: string;
  fulfillable_quantity: number;
  total_reserved_quantity: number;
  pending_customer_order_quantity: number;
  pending_transshipment_quantity: number;
  fc_processing_quantity: number;
  total_unfulfillable_quantity: number;
  customer_damaged_quantity: number;
  warehouse_damaged_quantity: number;
  distributor_damaged_quantity: number;
  inbound_shipped_quantity: number;
  inbound_working_quantity: number;
  inbound_receiving_quantity: number;
  total_quantity: number;
}

const BATCH_SIZE = 500;

async function upsertInventoryData(warehouse: string, rows: InventoryRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  let written = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values: string[] = [];
    const params: any[] = [];

    batch.forEach((row, idx) => {
      const offset = idx * 24;
      const placeholders = Array.from({ length: 24 }, (_, j) => `$${offset + j + 1}`);
      values.push(`(${placeholders.join(', ')})`);
      params.push(
        row.iwasku, row.asin || null, warehouse, row.fnsku || null,
        row.sku_list || null, row.total_quantity,
        row.fc_processing_quantity, row.total_reserved_quantity,
        row.pending_customer_order_quantity, row.pending_transshipment_quantity,
        row.fulfillable_quantity,
        0, 0, 0, 0, 0, // total_researching, future_supply_buyable, reserved_future_supply, expired, defective
        0, // carrier_damaged
        row.customer_damaged_quantity, row.warehouse_damaged_quantity,
        row.distributor_damaged_quantity, row.total_unfulfillable_quantity,
        row.inbound_shipped_quantity, row.inbound_working_quantity, row.inbound_receiving_quantity,
      );
    });

    await sharedPool.query(`
      INSERT INTO fba_inventory (
        iwasku, asin, warehouse, fnsku,
        sku_list, total_quantity,
        fc_processing_quantity, total_reserved_quantity,
        pending_customer_order_quantity, pending_transshipment_quantity,
        fulfillable_quantity,
        total_researching_quantity, future_supply_buyable_quantity,
        reserved_future_supply_quantity, expired_quantity, defective_quantity,
        carrier_damaged_quantity,
        customer_damaged_quantity, warehouse_damaged_quantity,
        distributor_damaged_quantity, total_unfulfillable_quantity,
        inbound_shipped_quantity, inbound_working_quantity, inbound_receiving_quantity
      ) VALUES ${values.join(', ')}
      ON CONFLICT (iwasku, warehouse) DO UPDATE SET
        asin = EXCLUDED.asin,
        fnsku = EXCLUDED.fnsku,
        sku_list = EXCLUDED.sku_list,
        total_quantity = EXCLUDED.total_quantity,
        fc_processing_quantity = EXCLUDED.fc_processing_quantity,
        total_reserved_quantity = EXCLUDED.total_reserved_quantity,
        pending_customer_order_quantity = EXCLUDED.pending_customer_order_quantity,
        pending_transshipment_quantity = EXCLUDED.pending_transshipment_quantity,
        fulfillable_quantity = EXCLUDED.fulfillable_quantity,
        customer_damaged_quantity = EXCLUDED.customer_damaged_quantity,
        warehouse_damaged_quantity = EXCLUDED.warehouse_damaged_quantity,
        distributor_damaged_quantity = EXCLUDED.distributor_damaged_quantity,
        total_unfulfillable_quantity = EXCLUDED.total_unfulfillable_quantity,
        inbound_shipped_quantity = EXCLUDED.inbound_shipped_quantity,
        inbound_working_quantity = EXCLUDED.inbound_working_quantity,
        inbound_receiving_quantity = EXCLUDED.inbound_receiving_quantity,
        updated_at = NOW()
    `, params);

    written += batch.length;
  }

  return written;
}

export async function writeInventoryData(): Promise<void> {
  const startTime = Date.now();
  let totalRows = 0;

  logger.info('[InventoryData] Starting fba_inventory refresh...');

  // Find warehouses that have data
  const whResult = await pool.query(
    'SELECT DISTINCT warehouse FROM fba_inventory WHERE warehouse = ANY($1)',
    [WAREHOUSES]
  );
  const activeWarehouses = whResult.rows.map((r: { warehouse: string }) => r.warehouse);
  logger.info(`[InventoryData] Active warehouses: ${activeWarehouses.join(', ')}`);

  for (const wh of activeWarehouses) {
    const result = await pool.query(INVENTORY_SQL, [wh]);
    const count = await upsertInventoryData(wh, result.rows);
    totalRows += count;
    logger.info(`[InventoryData] ${wh}: ${count} rows`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logger.info(`[InventoryData] Refresh complete: ${totalRows} total rows, ${elapsed}s`);
}

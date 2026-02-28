import { Router, Request, Response } from 'express';
import { pool } from '../config/database';
import logger from '../config/logger';

const router = Router();

const VALID_WAREHOUSES = ['US', 'UK', 'EU', 'CA', 'AU', 'AE', 'SA'];

// GET /api/v1/amazonfba/:warehouse
// StockPulse-compatible: returns array of inventory objects
router.get('/:warehouse', async (req: Request, res: Response) => {
  const warehouse = req.params.warehouse.toUpperCase();

  if (!VALID_WAREHOUSES.includes(warehouse)) {
    res.status(400).json({ error: `Invalid warehouse: ${warehouse}. Valid: ${VALID_WAREHOUSES.join(', ')}` });
    return;
  }

  try {
    const result = await pool.query(`
      WITH deduped AS (
        SELECT DISTINCT ON (COALESCE(iwasku, sku), fnsku)
          COALESCE(iwasku, sku) as iwasku,
          asin, fnsku,
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
        SUM(inbound_receiving_quantity)::int as inbound_receiving_quantity
      FROM deduped
      GROUP BY iwasku
      ORDER BY iwasku
    `, [warehouse]);

    logger.info(`[Inventory] Serving ${warehouse}: ${result.rows.length} items`);
    res.json(result.rows);
  } catch (err: any) {
    logger.error(`[Inventory] Error for warehouse ${warehouse}:`, err.message);
    res.status(500).json({ error: 'Failed to fetch inventory data' });
  }
});

export default router;

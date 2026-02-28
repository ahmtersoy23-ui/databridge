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
      SELECT
        COALESCE(iwasku, sku) as iwasku,
        asin,
        fnsku,
        fulfillable_quantity,
        total_reserved_quantity,
        pending_customer_order_quantity,
        pending_transshipment_quantity,
        fc_processing_quantity,
        total_unfulfillable_quantity,
        customer_damaged_quantity,
        warehouse_damaged_quantity,
        distributor_damaged_quantity,
        inbound_shipped_quantity,
        inbound_working_quantity,
        inbound_receiving_quantity
      FROM fba_inventory
      WHERE warehouse = $1
        AND sku NOT LIKE 'amzn.gr.%'
      ORDER BY COALESCE(iwasku, sku)
    `, [warehouse]);

    logger.info(`[Inventory] Serving ${warehouse}: ${result.rows.length} items`);
    res.json(result.rows);
  } catch (err: any) {
    logger.error(`[Inventory] Error for warehouse ${warehouse}:`, err.message);
    res.status(500).json({ error: 'Failed to fetch inventory data' });
  }
});

export default router;

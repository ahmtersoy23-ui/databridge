import { Router, Request, Response } from 'express';
import { pool } from '../config/database';
import logger from '../config/logger';

const router = Router();

// GET /api/v1/inventory-detail - Browse fba_inventory with pagination & filters
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;

    const { warehouse, search, matched } = req.query;

    const conditions: string[] = [];
    const params: any[] = [];
    let pi = 1;

    if (warehouse && typeof warehouse === 'string') {
      conditions.push(`warehouse = $${pi++}`);
      params.push(warehouse.toUpperCase());
    }
    if (search && typeof search === 'string') {
      const like = `%${search}%`;
      conditions.push(`(sku ILIKE $${pi} OR asin ILIKE $${pi} OR fnsku ILIKE $${pi} OR iwasku ILIKE $${pi})`);
      params.push(like);
      pi++;
    }
    if (matched === 'matched') {
      conditions.push('iwasku IS NOT NULL');
    } else if (matched === 'unmatched') {
      conditions.push('iwasku IS NULL');
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const [countResult, dataResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM fba_inventory ${where}`, params),
      pool.query(
        `SELECT id, warehouse, sku, asin, fnsku, iwasku,
                fulfillable_quantity, total_reserved_quantity,
                pending_customer_order_quantity, pending_transshipment_quantity,
                fc_processing_quantity, total_unfulfillable_quantity,
                customer_damaged_quantity, warehouse_damaged_quantity,
                distributor_damaged_quantity, inbound_shipped_quantity,
                inbound_working_quantity, inbound_receiving_quantity,
                last_synced_at
         FROM fba_inventory ${where}
         ORDER BY COALESCE(iwasku, sku), warehouse
         LIMIT $${pi} OFFSET $${pi + 1}`,
        [...params, limit, offset]
      ),
    ]);

    const total = parseInt(countResult.rows[0].count);
    res.json({
      success: true,
      data: {
        rows: dataResult.rows,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err: any) {
    logger.error('[InventoryDetail] Browse error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch inventory' });
  }
});

// GET /api/v1/inventory-detail/warehouses - Distinct warehouses for filter dropdown
router.get('/warehouses', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT DISTINCT warehouse FROM fba_inventory ORDER BY warehouse');
    res.json({ success: true, data: result.rows.map((r: any) => r.warehouse) });
  } catch (err: any) {
    logger.error('[InventoryDetail] Warehouses error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch warehouses' });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import { pool } from '../config/database';

const router = Router();

// GET /api/v1/takealot/inventory — aggregated per iwasku for StockPulse consumption
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        iwasku,
        sku,
        (array_agg(product_title))[1] AS product_title,
        SUM(stock_at_takealot_total)::int AS stock_at_takealot,
        SUM(total_stock_on_way)::int AS stock_on_way,
        SUM(total_stock_cover)::int AS stock_cover,
        MAX(leadtime_days) AS leadtime_days,
        MAX(last_synced_at) AS last_synced_at
      FROM takealot_inventory
      WHERE iwasku IS NOT NULL
      GROUP BY iwasku, sku
      ORDER BY stock_at_takealot DESC NULLS LAST, iwasku
    `);
    res.json({ data: result.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

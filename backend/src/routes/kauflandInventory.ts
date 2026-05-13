import { Router, Request, Response } from 'express';
import { pool } from '../config/database';

const router = Router();

// GET /api/v1/kaufland/inventory — aggregated per iwasku for StockPulse consumption
router.get('/', async (req: Request, res: Response) => {
  try {
    const accountId = req.query.accountId ? parseInt(req.query.accountId as string, 10) : null;
    const params: unknown[] = [];
    let where = 'WHERE iwasku IS NOT NULL';
    if (accountId) { where += ` AND account_id = $1`; params.push(accountId); }

    const result = await pool.query(
      `SELECT
         iwasku,
         (array_agg(offer_sku) FILTER (WHERE offer_sku IS NOT NULL))[1] AS offer_sku,
         (array_agg(ean) FILTER (WHERE ean IS NOT NULL))[1] AS ean,
         (array_agg(product_title) FILTER (WHERE product_title IS NOT NULL))[1] AS product_title,
         SUM(amount)::int AS amount,
         SUM(reserved_amount)::int AS reserved_amount,
         MAX(price)::numeric(12,2) AS price,
         (array_agg(status) FILTER (WHERE status IS NOT NULL))[1] AS status,
         MAX(last_synced_at) AS last_synced_at
       FROM kaufland_inventory
       ${where}
       GROUP BY iwasku
       ORDER BY amount DESC NULLS LAST, iwasku`,
      params,
    );
    res.json({ data: result.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

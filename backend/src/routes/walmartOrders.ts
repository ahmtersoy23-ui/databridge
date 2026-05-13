import { Router, Request, Response } from 'express';
import { pool } from '../config/database';

const router = Router();

// GET /api/v1/walmart/orders/browse?page=1&limit=50&search=&status=
router.get('/browse', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
    const search = ((req.query.search as string) || '').trim();
    const status = ((req.query.status as string) || '').trim();
    const offset = (page - 1) * limit;

    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    let idx = 1;

    if (search) {
      conditions.push(
        `(sku ILIKE $${idx} OR iwasku ILIKE $${idx} OR purchase_order_id ILIKE $${idx} ` +
        `OR customer_order_id ILIKE $${idx} OR product_name ILIKE $${idx})`,
      );
      params.push(`%${search}%`);
      idx++;
    }

    if (status) {
      conditions.push(`order_status = $${idx}`);
      params.push(status);
      idx++;
    }

    const where = conditions.join(' AND ');

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM walmart_raw_orders WHERE ${where}`,
      params,
    );
    const total = parseInt(countRes.rows[0].count, 10);

    const dataRes = await pool.query(
      `SELECT
         customer_order_id, purchase_order_id, order_date_local, line_number,
         sku, iwasku, product_name, quantity, unit_price, item_price, currency,
         order_status, ship_node_type, shipping_state, shipping_postal_code
       FROM walmart_raw_orders
       WHERE ${where}
       ORDER BY order_date_local DESC, purchase_order_id, line_number
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset],
    );

    res.json({
      success: true,
      data: dataRes.rows,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/walmart/orders/analysis?days=30
router.get('/analysis', async (req: Request, res: Response) => {
  try {
    const days = Math.min(366, Math.max(1, parseInt(req.query.days as string) || 30));

    const result = await pool.query(
      `SELECT
         sku,
         iwasku,
         (array_agg(product_name ORDER BY order_date_local DESC) FILTER (WHERE product_name IS NOT NULL))[1] AS product_name,
         SUM(quantity)::int AS total_qty,
         SUM(item_price)::numeric(12,2) AS total_revenue,
         COUNT(DISTINCT customer_order_id)::int AS order_count,
         CASE WHEN SUM(quantity) > 0
              THEN (SUM(item_price) / SUM(quantity))::numeric(12,2)
              ELSE 0 END AS avg_unit_price,
         MAX(order_date_local) AS last_order_date
       FROM walmart_raw_orders
       WHERE order_date_local >= CURRENT_DATE - $1::int
       GROUP BY sku, iwasku
       ORDER BY total_qty DESC`,
      [days],
    );

    const rows = result.rows;
    const matched = rows.filter((r: any) => r.iwasku).length;
    res.json({
      success: true,
      data: rows,
      summary: {
        totalSkus: rows.length,
        totalQty: rows.reduce((s: number, r: any) => s + Number(r.total_qty), 0),
        totalRevenue: rows.reduce((s: number, r: any) => s + Number(r.total_revenue), 0),
        matched,
        unmatched: rows.length - matched,
        days,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/walmart/orders/statuses — distinct statuses for filter dropdown
router.get('/statuses', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT order_status, COUNT(*)::int AS cnt
       FROM walmart_raw_orders
       WHERE order_status IS NOT NULL
       GROUP BY order_status
       ORDER BY cnt DESC`,
    );
    res.json({ success: true, data: result.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

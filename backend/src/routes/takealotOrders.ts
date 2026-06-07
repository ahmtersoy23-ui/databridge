import { Router, Request, Response } from 'express';
import { pool } from '../config/database';

const router = Router();

router.get('/browse', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
    const search = ((req.query.search as string) || '').trim();
    const showCancelled = req.query.showCancelled === 'true';
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    if (!showCancelled) {
      conditions.push(`COALESCE(sale_status, true) = true`);
    }
    if (search) {
      conditions.push(
        `(sku ILIKE $${idx} OR iwasku ILIKE $${idx} OR product_title ILIKE $${idx} ` +
        `OR order_id::text = $${idx + 1} OR tsin::text = $${idx + 1})`,
      );
      params.push(`%${search}%`, search);
      idx += 2;
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await pool.query(`SELECT COUNT(*) FROM takealot_raw_orders ${where}`, params);
    const total = parseInt(countRes.rows[0].count, 10);

    const data = await pool.query(
      `SELECT order_id, order_item_id, order_date_local, sku, tsin, iwasku, product_title,
              quantity, selling_price, item_price, dc, customer_dc, sale_status, promotion
       FROM takealot_raw_orders ${where}
       ORDER BY order_date_local DESC, order_id, order_item_id
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset],
    );

    res.json({
      success: true,
      data: data.rows,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/analysis', async (req: Request, res: Response) => {
  try {
    const days = Math.min(366, Math.max(1, parseInt(req.query.days as string) || 30));

    const result = await pool.query(
      `SELECT
         sku, tsin, iwasku,
         (array_agg(product_title ORDER BY order_date_local DESC) FILTER (WHERE product_title IS NOT NULL))[1] AS product_title,
         SUM(quantity)::int AS total_qty,
         SUM(item_price)::numeric(12,2) AS total_revenue,
         COUNT(DISTINCT order_id)::int AS order_count,
         CASE WHEN SUM(quantity) > 0 THEN (SUM(item_price) / SUM(quantity))::numeric(12,2) ELSE 0 END AS avg_unit_price,
         MAX(order_date_local) AS last_order_date
       FROM takealot_raw_orders
       WHERE order_date_local >= CURRENT_DATE - $1::int
         AND COALESCE(sale_status, true) = true
       GROUP BY sku, tsin, iwasku
       ORDER BY total_qty DESC`,
      [days],
    );

    const rows: { iwasku: string | null; total_qty: number | string; total_revenue: number | string }[] = result.rows;
    const matched = rows.filter(r => r.iwasku).length;
    res.json({
      success: true,
      data: rows,
      summary: {
        totalSkus: rows.length,
        totalQty: rows.reduce((s: number, r) => s + Number(r.total_qty), 0),
        totalRevenue: rows.reduce((s: number, r) => s + Number(r.total_revenue), 0),
        matched,
        unmatched: rows.length - matched,
        days,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

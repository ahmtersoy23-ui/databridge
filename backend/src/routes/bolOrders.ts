import { Router, Request, Response } from 'express';
import { errMessage } from '../utils/errors';
import { pool } from '../config/database';
import { getAccountByLabel } from '../services/bol/client';

const router = Router();

// GET /api/v1/bol/orders/browse?account=pera&page=1&limit=50&search=&fulfilment=FBR
router.get('/browse', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
    const search = ((req.query.search as string) || '').trim();
    const accountLabel = req.query.account as string | undefined;
    const fulfilment = ((req.query.fulfilment as string) || '').trim();
    const offset = (page - 1) * limit;

    const conditions = ['1=1'];
    const params: unknown[] = [];
    let idx = 1;

    if (accountLabel) {
      const account = await getAccountByLabel(accountLabel);
      conditions.push(`account_id = $${idx}`);
      params.push(account.id);
      idx++;
    }
    if (search) {
      conditions.push(
        `(sku ILIKE $${idx} OR iwasku ILIKE $${idx} OR order_id ILIKE $${idx} ` +
        `OR ean ILIKE $${idx} OR product_title ILIKE $${idx})`,
      );
      params.push(`%${search}%`);
      idx++;
    }
    if (fulfilment) {
      conditions.push(`fulfilment_method = $${idx}`);
      params.push(fulfilment);
      idx++;
    }

    const where = conditions.join(' AND ');

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM bol_raw_orders WHERE ${where}`,
      params,
    );
    const total = parseInt(countRes.rows[0].count, 10);

    const data = await pool.query(
      `SELECT order_id, order_item_id, order_date_local, sku, iwasku, ean,
              product_title, quantity, unit_price, item_price, currency, fulfilment_method,
              is_cancelled
       FROM bol_raw_orders
       WHERE ${where}
       ORDER BY order_date_local DESC, order_id, order_item_id
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset],
    );

    res.json({
      success: true,
      data: data.rows,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: errMessage(err) });
  }
});

// GET /api/v1/bol/orders/analysis?account=pera&days=30
router.get('/analysis', async (req: Request, res: Response) => {
  try {
    const accountLabel = req.query.account as string | undefined;
    const days = Math.min(366, Math.max(1, parseInt(req.query.days as string) || 30));

    const conditions = ['order_date_local >= CURRENT_DATE - $1::int', 'is_cancelled = false'];
    const params: unknown[] = [days];
    let idx = 2;

    if (accountLabel) {
      const account = await getAccountByLabel(accountLabel);
      conditions.push(`account_id = $${idx}`);
      params.push(account.id);
      idx++;
    }

    const where = conditions.join(' AND ');

    const result = await pool.query(
      `SELECT
         sku,
         iwasku,
         (array_agg(product_title ORDER BY order_date_local DESC) FILTER (WHERE product_title IS NOT NULL))[1] AS product_title,
         SUM(quantity)::int AS total_qty,
         SUM(item_price)::numeric(12,2) AS total_revenue,
         COUNT(DISTINCT order_id)::int AS order_count,
         CASE WHEN SUM(quantity) > 0
              THEN (SUM(item_price) / SUM(quantity))::numeric(12,2)
              ELSE 0 END AS avg_unit_price,
         MAX(order_date_local) AS last_order_date
       FROM bol_raw_orders
       WHERE ${where}
       GROUP BY sku, iwasku
       ORDER BY total_qty DESC`,
      params,
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
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: errMessage(err) });
  }
});

export default router;

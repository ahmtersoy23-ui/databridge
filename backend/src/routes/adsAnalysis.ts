import { Router, Request, Response } from 'express';
import { pool } from '../config/database';

const router = Router();

const ALLOWED_SORT_COLS = new Set([
  'customer_search_term', 'impressions', 'clicks', 'ctr', 'cpc',
  'spend', 'sales', 'acos', 'orders', 'campaign_name',
]);

function safeInt(val: unknown, fallback: number, min = 1, max = 10000): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

// GET /api/v1/ads-analysis/summary?days=14
router.get('/summary', async (req: Request, res: Response) => {
  const days = safeInt(req.query.days, 14, 1, 365);

  try {
    const result = await pool.query(
      `SELECT
         COALESCE(SUM(spend), 0)        AS spend,
         COALESCE(SUM(sales_7d), 0)     AS sales,
         COALESCE(SUM(impressions), 0)   AS impressions,
         COALESCE(SUM(clicks), 0)        AS clicks,
         COALESCE(SUM(orders_7d), 0)     AS orders,
         MIN(report_date)                AS period_from,
         MAX(report_date)                AS period_to
       FROM ads_search_term_report
       WHERE report_date >= CURRENT_DATE - $1::int`,
      [days],
    );

    const row = result.rows[0];
    const spend = Number(row.spend);
    const sales = Number(row.sales);
    const impressions = Number(row.impressions);
    const clicks = Number(row.clicks);
    const orders = Number(row.orders);

    const acos = spend > 0 && sales > 0 ? (spend / sales) * 100 : spend > 0 ? 999 : 0;
    const roas = spend > 0 ? sales / spend : 0;
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;

    res.json({
      success: true,
      data: {
        spend: Math.round(spend * 100) / 100,
        sales: Math.round(sales * 100) / 100,
        acos: Math.round(acos * 100) / 100,
        roas: Math.round(roas * 100) / 100,
        impressions,
        clicks,
        ctr: Math.round(ctr * 100) / 100,
        cpc: Math.round(cpc * 100) / 100,
        orders,
        period: { from: row.period_from, to: row.period_to },
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/ads-analysis/search-terms?days=14&sort=spend&order=desc&limit=100&offset=0
router.get('/search-terms', async (req: Request, res: Response) => {
  const days = safeInt(req.query.days, 14, 1, 365);
  const limit = safeInt(req.query.limit, 100, 1, 500);
  const offset = safeInt(req.query.offset, 0, 0, 100000);
  const sortCol = ALLOWED_SORT_COLS.has(String(req.query.sort)) ? String(req.query.sort) : 'spend';
  const order = req.query.order === 'asc' ? 'ASC' : 'DESC';

  try {
    // Count total distinct search terms in period
    const countResult = await pool.query(
      `SELECT COUNT(DISTINCT customer_search_term) AS total
       FROM ads_search_term_report
       WHERE report_date >= CURRENT_DATE - $1::int`,
      [days],
    );
    const total = Number(countResult.rows[0].total);

    const result = await pool.query(
      `SELECT
         customer_search_term AS "searchTerm",
         SUM(impressions)::bigint       AS impressions,
         SUM(clicks)::bigint            AS clicks,
         CASE WHEN SUM(impressions) > 0
              THEN ROUND(SUM(clicks)::numeric / SUM(impressions) * 100, 2)
              ELSE 0 END                AS ctr,
         CASE WHEN SUM(clicks) > 0
              THEN ROUND(SUM(spend)::numeric / SUM(clicks), 2)
              ELSE 0 END                AS cpc,
         ROUND(SUM(spend)::numeric, 2)         AS spend,
         ROUND(SUM(sales_7d)::numeric, 2)      AS sales,
         CASE WHEN SUM(spend) > 0 AND SUM(sales_7d) > 0
              THEN ROUND(SUM(spend)::numeric / SUM(sales_7d) * 100, 2)
              WHEN SUM(spend) > 0 THEN 999
              ELSE 0 END                AS acos,
         SUM(orders_7d)::bigint         AS orders
       FROM ads_search_term_report
       WHERE report_date >= CURRENT_DATE - $1::int
       GROUP BY customer_search_term
       ORDER BY ${sortCol} ${order}
       LIMIT $2 OFFSET $3`,
      [days, limit, offset],
    );

    res.json({
      success: true,
      data: {
        rows: result.rows,
        total,
        limit,
        offset,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/ads-analysis/campaigns?days=14&sort=spend&order=desc
router.get('/campaigns', async (req: Request, res: Response) => {
  const days = safeInt(req.query.days, 14, 1, 365);
  const sortCol = ALLOWED_SORT_COLS.has(String(req.query.sort)) ? String(req.query.sort) : 'spend';
  const order = req.query.order === 'asc' ? 'ASC' : 'DESC';

  try {
    const result = await pool.query(
      `SELECT
         campaign_name AS "campaignName",
         SUM(impressions)::bigint       AS impressions,
         SUM(clicks)::bigint            AS clicks,
         ROUND(SUM(spend)::numeric, 2)         AS spend,
         ROUND(SUM(sales_7d)::numeric, 2)      AS sales,
         CASE WHEN SUM(spend) > 0 AND SUM(sales_7d) > 0
              THEN ROUND(SUM(spend)::numeric / SUM(sales_7d) * 100, 2)
              WHEN SUM(spend) > 0 THEN 999
              ELSE 0 END                AS acos,
         SUM(orders_7d)::bigint         AS orders
       FROM ads_search_term_report
       WHERE report_date >= CURRENT_DATE - $1::int
       GROUP BY campaign_name
       ORDER BY ${sortCol} ${order}`,
      [days],
    );

    res.json({ success: true, data: { rows: result.rows } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

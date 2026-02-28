import { Router, Request, Response } from 'express';
import { pool } from '../config/database';
import logger from '../config/logger';

const router = Router();

const VALID_CHANNELS = ['us', 'uk', 'de', 'fr', 'it', 'es', 'ca', 'au', 'ae', 'sa'];

// GET /api/v1/amazonsales/:channel
// StockPulse-compatible: returns array of sales objects with rolling windows
router.get('/:channel', async (req: Request, res: Response) => {
  const channel = req.params.channel.toLowerCase();

  if (!VALID_CHANNELS.includes(channel)) {
    res.status(400).json({ error: `Invalid channel: ${channel}. Valid: ${VALID_CHANNELS.join(', ')}` });
    return;
  }

  try {
    const result = await pool.query(`
      SELECT
        COALESCE(o.iwasku, o.sku) as iwasku,
        o.asin,
        COALESCE(SUM(CASE WHEN o.purchase_date_local >= CURRENT_DATE - 7 THEN o.quantity END), 0)::numeric as "last7",
        COALESCE(SUM(CASE WHEN o.purchase_date_local >= CURRENT_DATE - 30 THEN o.quantity END), 0)::numeric as "last30",
        COALESCE(SUM(CASE WHEN o.purchase_date_local >= CURRENT_DATE - 90 THEN o.quantity END), 0)::numeric as "last90",
        COALESCE(SUM(CASE WHEN o.purchase_date_local >= CURRENT_DATE - 180 THEN o.quantity END), 0)::numeric as "last180",
        COALESCE(SUM(CASE WHEN o.purchase_date_local >= CURRENT_DATE - 366 THEN o.quantity END), 0)::numeric as "last366",

        -- Previous year: same lookback periods
        COALESCE(SUM(CASE WHEN o.purchase_date_local BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date - 7 AND (CURRENT_DATE - INTERVAL '1 year')::date THEN o.quantity END), 0)::numeric as "preYearLast7",
        COALESCE(SUM(CASE WHEN o.purchase_date_local BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date - 30 AND (CURRENT_DATE - INTERVAL '1 year')::date THEN o.quantity END), 0)::numeric as "preYearLast30",
        COALESCE(SUM(CASE WHEN o.purchase_date_local BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date - 90 AND (CURRENT_DATE - INTERVAL '1 year')::date THEN o.quantity END), 0)::numeric as "preYearLast90",
        COALESCE(SUM(CASE WHEN o.purchase_date_local BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date - 180 AND (CURRENT_DATE - INTERVAL '1 year')::date THEN o.quantity END), 0)::numeric as "preYearLast180",
        COALESCE(SUM(CASE WHEN o.purchase_date_local BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date - 365 AND (CURRENT_DATE - INTERVAL '1 year')::date THEN o.quantity END), 0)::numeric as "preYearLast365",

        -- Previous year: forward-looking periods (for forecast basis)
        COALESCE(SUM(CASE WHEN o.purchase_date_local BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date AND (CURRENT_DATE - INTERVAL '1 year')::date + 7 THEN o.quantity END), 0)::numeric as "preYearNext7",
        COALESCE(SUM(CASE WHEN o.purchase_date_local BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date AND (CURRENT_DATE - INTERVAL '1 year')::date + 30 THEN o.quantity END), 0)::numeric as "preYearNext30",
        COALESCE(SUM(CASE WHEN o.purchase_date_local BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date AND (CURRENT_DATE - INTERVAL '1 year')::date + 90 THEN o.quantity END), 0)::numeric as "preYearNext90",
        COALESCE(SUM(CASE WHEN o.purchase_date_local BETWEEN (CURRENT_DATE - INTERVAL '1 year')::date AND (CURRENT_DATE - INTERVAL '1 year')::date + 180 THEN o.quantity END), 0)::numeric as "preYearNext180"
      FROM raw_orders o
      WHERE o.channel = $1
        AND o.purchase_date_local >= (CURRENT_DATE - INTERVAL '2 years')::date
        AND o.sku NOT LIKE 'amzn.gr.%'
      GROUP BY COALESCE(o.iwasku, o.sku), o.asin
      ORDER BY COALESCE(o.iwasku, o.sku)
    `, [channel]);

    logger.info(`[Sales] Serving ${channel}: ${result.rows.length} items`);
    res.json(result.rows);
  } catch (err: any) {
    logger.error(`[Sales] Error for channel ${channel}:`, err.message);
    res.status(500).json({ error: 'Failed to fetch sales data' });
  }
});

export default router;

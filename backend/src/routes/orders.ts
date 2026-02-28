import { Router, Request, Response } from 'express';
import { pool } from '../config/database';
import logger from '../config/logger';

const router = Router();

// GET /api/v1/orders - Browse raw_orders with pagination & filters
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;

    const { channel, dateFrom, dateTo, search, matched, sort } = req.query;

    const conditions: string[] = [];
    const params: any[] = [];
    let pi = 1;

    if (channel && typeof channel === 'string') {
      conditions.push(`channel = $${pi++}`);
      params.push(channel.toLowerCase());
    }
    if (dateFrom && typeof dateFrom === 'string') {
      conditions.push(`purchase_date_local >= $${pi++}`);
      params.push(dateFrom);
    }
    if (dateTo && typeof dateTo === 'string') {
      conditions.push(`purchase_date_local <= $${pi++}`);
      params.push(dateTo);
    }
    if (search && typeof search === 'string') {
      const like = `%${search}%`;
      conditions.push(`(sku ILIKE $${pi} OR asin ILIKE $${pi} OR iwasku ILIKE $${pi})`);
      params.push(like);
      pi++;
    }
    if (matched === 'matched') {
      conditions.push('iwasku IS NOT NULL');
    } else if (matched === 'unmatched') {
      conditions.push('iwasku IS NULL');
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const orderDir = sort === 'date_asc' ? 'ASC' : 'DESC';

    const [countResult, dataResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM raw_orders ${where}`, params),
      pool.query(
        `SELECT id, channel, amazon_order_id, purchase_date_local, sku, asin, iwasku,
                quantity, item_price, currency, order_status, fulfillment_channel
         FROM raw_orders ${where}
         ORDER BY purchase_date_local ${orderDir}, id DESC
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
    logger.error('[Orders] Browse error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch orders' });
  }
});

// GET /api/v1/orders/channels - Distinct channels for filter dropdown
router.get('/channels', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT DISTINCT channel FROM raw_orders ORDER BY channel');
    res.json({ success: true, data: result.rows.map((r: any) => r.channel) });
  } catch (err: any) {
    logger.error('[Orders] Channels error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch channels' });
  }
});

export default router;

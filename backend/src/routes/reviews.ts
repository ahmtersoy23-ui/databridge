import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/database';
import { validateBody } from '../middleware/validate';
import logger from '../config/logger';

const router = Router();

// GET /api/v1/reviews — Current rating/review snapshot for all tracked ASINs
router.get('/', async (req: Request, res: Response) => {
  try {
    const { country_code } = req.query;
    let query = `
      SELECT pr.asin, pr.country_code, pr.rating, pr.review_count,
             pr.last_review_title, pr.last_review_text, pr.last_review_rating,
             pr.last_review_date, pr.last_review_author,
             pr.is_blocked, pr.checked_at, pr.updated_at,
             rta.label,
             prev.rating AS prev_rating,
             prev.review_count AS prev_review_count
      FROM product_reviews pr
      LEFT JOIN review_tracked_asins rta ON pr.asin = rta.asin AND pr.country_code = rta.country_code
      LEFT JOIN LATERAL (
        SELECT rating, review_count
        FROM product_reviews_history h
        WHERE h.asin = pr.asin AND h.country_code = pr.country_code
        ORDER BY h.recorded_at DESC
        OFFSET 1 LIMIT 1
      ) prev ON true
      WHERE 1=1
    `;
    const params: any[] = [];

    if (country_code) {
      params.push(String(country_code).toUpperCase());
      query += ` AND pr.country_code = $${params.length}`;
    }

    query += ' ORDER BY pr.country_code, pr.asin';

    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/reviews/:asin/history — Rating/count trend for an ASIN
router.get('/:asin/history', async (req: Request, res: Response) => {
  try {
    const { asin } = req.params;
    const { country_code } = req.query;

    let query = 'SELECT asin, country_code, rating, review_count, recorded_at FROM product_reviews_history WHERE asin = $1';
    const params: any[] = [asin.toUpperCase()];

    if (country_code) {
      params.push(String(country_code).toUpperCase());
      query += ` AND country_code = $${params.length}`;
    }

    query += ' ORDER BY recorded_at DESC LIMIT 100';

    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/reviews/:asin/items — Archived review items for an ASIN
router.get('/:asin/items', async (req: Request, res: Response) => {
  try {
    const { asin } = req.params;
    const { country_code } = req.query;

    let query = 'SELECT id, asin, country_code, title, body, rating, review_date, author, is_verified, fetched_at FROM product_review_items WHERE asin = $1';
    const params: any[] = [asin.toUpperCase()];

    if (country_code) {
      params.push(String(country_code).toUpperCase());
      query += ` AND country_code = $${params.length}`;
    }

    query += ' ORDER BY fetched_at DESC LIMIT 50';

    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/reviews/tracked — List tracked ASINs
router.get('/tracked', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, asin, country_code, label, is_active, created_at FROM review_tracked_asins WHERE is_active = true ORDER BY country_code, asin'
    );
    res.json({ success: true, data: result.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/reviews/tracked — Add single ASIN
const addSchema = z.object({
  asin: z.string().min(5).max(20),
  country_code: z.string().min(2).max(5).default('US'),
  label: z.string().max(200).optional(),
});

router.post('/tracked', validateBody(addSchema), async (req: Request, res: Response) => {
  try {
    const { asin, country_code, label } = req.body;
    const result = await pool.query(
      `INSERT INTO review_tracked_asins (asin, country_code, label)
       VALUES ($1, $2, $3)
       ON CONFLICT (asin, country_code) DO UPDATE SET label = COALESCE($3, review_tracked_asins.label), is_active = true
       RETURNING *`,
      [asin.toUpperCase(), country_code.toUpperCase(), label || null]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/reviews/tracked/bulk — Bulk add ASINs
const bulkSchema = z.object({
  items: z.array(z.object({
    asin: z.string().min(5).max(20),
    country_code: z.string().min(2).max(5).default('US'),
    label: z.string().max(200).optional(),
  })).min(1).max(500),
});

router.post('/tracked/bulk', validateBody(bulkSchema), async (req: Request, res: Response) => {
  try {
    const { items } = req.body;
    let added = 0;

    for (const item of items) {
      await pool.query(
        `INSERT INTO review_tracked_asins (asin, country_code, label)
         VALUES ($1, $2, $3)
         ON CONFLICT (asin, country_code) DO UPDATE SET label = COALESCE($3, review_tracked_asins.label), is_active = true`,
        [item.asin.toUpperCase(), item.country_code.toUpperCase(), item.label || null]
      );
      added++;
    }

    res.json({ success: true, message: `${added} ASINs added/updated` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/v1/reviews/tracked/:id — Remove ASIN from tracking (soft delete)
router.delete('/tracked/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE review_tracked_asins SET is_active = false WHERE id = $1', [id]);
    res.json({ success: true, message: 'ASIN deactivated' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/reviews/reset-blocks — Reset blocked ASINs
router.post('/reset-blocks', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'UPDATE product_reviews SET is_blocked = false, block_count = 0 WHERE is_blocked = true'
    );
    res.json({ success: true, message: `${result.rowCount} ASINs unblocked` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import { pool } from '../config/database';

const router = Router();

// GET /api/v1/catalog — All Wisersell products
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT id, name, code, weight, deci, width, length, height,
             arr_sku, category_id, synced_at
      FROM wisersell_products
      ORDER BY code NULLS LAST, name
    `);
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

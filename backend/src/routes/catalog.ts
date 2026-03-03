import { Router, Request, Response } from 'express';
import { pool } from '../config/database';

const router = Router();

// GET /api/v1/catalog — All Wisersell products
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT wp.id, wp.name, wp.code, wp.weight, wp.deci,
             wp.width, wp.length, wp.height,
             wp.arr_sku, wp.category_id, wp.size, wp.color,
             wc.name AS category_name,
             wp.synced_at
      FROM wisersell_products wp
      LEFT JOIN wisersell_categories wc ON wp.category_id = wc.id
      ORDER BY wp.code NULLS LAST, wp.name
    `);
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { pool } from '../config/database';
import { validateBody } from '../middleware/validate';

const router = Router();

const mappingSchema = z.object({
  sku: z.string().min(1).max(100),
  iwasku: z.string().min(1).max(50),
});
const bulkSchema = z.object({ mappings: z.array(mappingSchema).min(1).max(5000) });

async function applyMapping(sku: string, iwasku: string): Promise<void> {
  await pool.query(
    `INSERT INTO takealot_sku_mapping (sku, iwasku) VALUES ($1, $2)
     ON CONFLICT (sku) DO UPDATE SET iwasku = EXCLUDED.iwasku, updated_at = NOW()`,
    [sku, iwasku],
  );
  await pool.query('UPDATE takealot_raw_orders SET iwasku = $1 WHERE sku = $2', [iwasku, sku]);
  await pool.query('UPDATE takealot_inventory   SET iwasku = $1 WHERE sku = $2', [iwasku, sku]);
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const filter = (req.query.filter as string) || 'all';
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
    const search = ((req.query.search as string) || '').trim();
    const offset = (page - 1) * limit;

    let where = 'WHERE bo.sku IS NOT NULL';
    const params: unknown[] = [];
    let idx = 1;
    if (filter === 'matched') where += ' AND bo.iwasku IS NOT NULL';
    else if (filter === 'unmatched') where += ' AND bo.iwasku IS NULL';
    if (search) {
      where += ` AND (bo.sku ILIKE $${idx} OR bo.iwasku ILIKE $${idx} OR bo.product_title ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM (
         SELECT bo.sku FROM takealot_raw_orders bo
         ${where}
         GROUP BY bo.sku, bo.iwasku
       ) sub`,
      params,
    );
    const total = parseInt(countResult.rows[0].total, 10);

    const data = await pool.query(
      `SELECT bo.sku, bo.iwasku, bo.tsin,
              (array_agg(bo.product_title ORDER BY bo.order_date_local DESC) FILTER (WHERE bo.product_title IS NOT NULL))[1] AS product_title,
              SUM(bo.quantity)::int AS total_qty,
              MAX(bo.order_date_local) AS last_order_date,
              m.updated_at AS mapped_at
       FROM takealot_raw_orders bo
       LEFT JOIN takealot_sku_mapping m ON m.sku = bo.sku
       ${where}
       GROUP BY bo.sku, bo.iwasku, bo.tsin, m.updated_at
       ORDER BY (bo.iwasku IS NULL) DESC, bo.sku
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

router.post('/', validateBody(mappingSchema), async (req: Request, res: Response) => {
  const { sku, iwasku } = req.body;
  try { await applyMapping(sku, iwasku); res.json({ success: true }); }
  catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/bulk', validateBody(bulkSchema), async (req: Request, res: Response) => {
  const { mappings } = req.body as { mappings: Array<{ sku: string; iwasku: string }> };
  try {
    let upserted = 0;
    for (const m of mappings) { await applyMapping(m.sku, m.iwasku); upserted++; }
    res.json({ success: true, upserted });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

router.delete('/:sku', async (req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM takealot_sku_mapping WHERE sku = $1', [req.params.sku]);
    await pool.query('UPDATE takealot_raw_orders SET iwasku = NULL WHERE sku = $1', [req.params.sku]);
    await pool.query('UPDATE takealot_inventory   SET iwasku = NULL WHERE sku = $1', [req.params.sku]);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/export', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT bo.sku, COALESCE(bo.iwasku, '') AS iwasku, bo.tsin,
             SUM(bo.quantity)::int AS total_qty,
             MAX(bo.order_date_local) AS last_order_date
      FROM takealot_raw_orders bo
      WHERE bo.sku IS NOT NULL
      GROUP BY bo.sku, bo.iwasku, bo.tsin
      ORDER BY bo.sku
    `);
    const rows = result.rows.map((r: any) => ({
      sku: r.sku, iwasku: r.iwasku, tsin: r.tsin,
      total_qty: Number(r.total_qty), last_order_date: r.last_order_date,
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows, { header: ['sku', 'iwasku', 'tsin', 'total_qty', 'last_order_date'] });
    ws['!cols'] = [{ wch: 25 }, { wch: 20 }, { wch: 12 }, { wch: 10 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Takealot Mappings');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="takealot_mappings.xlsx"');
    res.send(buf);
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

export default router;

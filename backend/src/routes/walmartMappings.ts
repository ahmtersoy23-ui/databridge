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

const bulkSchema = z.object({
  mappings: z.array(mappingSchema).min(1).max(5000),
});

// GET /api/v1/walmart/mappings?filter=all|matched|unmatched&page=1&limit=50&search=
router.get('/', async (req: Request, res: Response) => {
  try {
    const filter = (req.query.filter as string) || 'all';
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
    const search = ((req.query.search as string) || '').trim();
    const offset = (page - 1) * limit;

    let whereClause = '';
    const params: unknown[] = [];
    let idx = 1;

    if (filter === 'matched') {
      whereClause = 'WHERE wo.iwasku IS NOT NULL';
    } else if (filter === 'unmatched') {
      whereClause = 'WHERE wo.iwasku IS NULL';
    }

    if (search) {
      const cond = `(wo.sku ILIKE $${idx} OR wo.iwasku ILIKE $${idx} OR wo.product_name ILIKE $${idx})`;
      whereClause = whereClause ? `${whereClause} AND ${cond}` : `WHERE ${cond}`;
      params.push(`%${search}%`);
      idx++;
    }

    // Aggregate distinct SKUs from walmart_raw_orders (mapping iwasku takes priority via COALESCE)
    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM (
         SELECT wo.sku
         FROM walmart_raw_orders wo
         ${whereClause}
         GROUP BY wo.sku, wo.iwasku
       ) sub`,
      params,
    );
    const total = parseInt(countResult.rows[0].total, 10);

    const dataResult = await pool.query(
      `SELECT
         wo.sku,
         wo.iwasku,
         (array_agg(wo.product_name ORDER BY wo.order_date_local DESC) FILTER (WHERE wo.product_name IS NOT NULL))[1] AS product_name,
         SUM(wo.quantity)::int AS total_qty,
         MAX(wo.order_date_local) AS last_order_date,
         m.updated_at AS mapped_at
       FROM walmart_raw_orders wo
       LEFT JOIN walmart_sku_mapping m ON m.sku = wo.sku
       ${whereClause}
       GROUP BY wo.sku, wo.iwasku, m.updated_at
       ORDER BY (wo.iwasku IS NULL) DESC, wo.sku
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset],
    );

    res.json({
      success: true,
      data: dataResult.rows,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

async function applyMapping(sku: string, iwasku: string): Promise<void> {
  await pool.query(
    `INSERT INTO walmart_sku_mapping (sku, iwasku)
     VALUES ($1, $2)
     ON CONFLICT (sku) DO UPDATE SET iwasku = EXCLUDED.iwasku, updated_at = NOW()`,
    [sku, iwasku],
  );
  // Backfill existing orders
  await pool.query(
    'UPDATE walmart_raw_orders SET iwasku = $1 WHERE sku = $2',
    [iwasku, sku],
  );
}

// POST /api/v1/walmart/mappings — single upsert
router.post('/', validateBody(mappingSchema), async (req: Request, res: Response) => {
  const { sku, iwasku } = req.body;
  try {
    await applyMapping(sku, iwasku);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/walmart/mappings/bulk
router.post('/bulk', validateBody(bulkSchema), async (req: Request, res: Response) => {
  const { mappings } = req.body as { mappings: Array<{ sku: string; iwasku: string }> };
  try {
    let upserted = 0;
    const BATCH = 500;
    for (let i = 0; i < mappings.length; i += BATCH) {
      const batch = mappings.slice(i, i + BATCH);
      const placeholders: string[] = [];
      const params: unknown[] = [];
      batch.forEach((m, j) => {
        placeholders.push(`($${j * 2 + 1}, $${j * 2 + 2})`);
        params.push(m.sku, m.iwasku);
      });
      await pool.query(
        `INSERT INTO walmart_sku_mapping (sku, iwasku)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (sku) DO UPDATE SET iwasku = EXCLUDED.iwasku, updated_at = NOW()`,
        params,
      );
      // Backfill raw_orders for each batch
      for (const m of batch) {
        await pool.query(
          'UPDATE walmart_raw_orders SET iwasku = $1 WHERE sku = $2',
          [m.iwasku, m.sku],
        );
      }
      upserted += batch.length;
    }
    res.json({ success: true, upserted });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/walmart/mappings/all — full sku -> iwasku map
router.get('/all', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT sku, iwasku FROM walmart_sku_mapping WHERE iwasku IS NOT NULL',
    );
    const map: Record<string, string> = {};
    for (const r of result.rows) map[r.sku] = r.iwasku;
    res.json({ success: true, data: map });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/v1/walmart/mappings/:sku
router.delete('/:sku', async (req: Request, res: Response) => {
  const { sku } = req.params;
  try {
    await pool.query('DELETE FROM walmart_sku_mapping WHERE sku = $1', [sku]);
    await pool.query(
      'UPDATE walmart_raw_orders SET iwasku = NULL WHERE sku = $1',
      [sku],
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/walmart/mappings/export — Excel
router.get('/export', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        wo.sku,
        COALESCE(wo.iwasku, '') AS iwasku,
        SUM(wo.quantity)::int AS total_qty,
        MAX(wo.order_date_local) AS last_order_date
      FROM walmart_raw_orders wo
      GROUP BY wo.sku, wo.iwasku
      ORDER BY wo.sku
    `);

    const rows = result.rows.map((r: any) => ({
      sku: r.sku,
      iwasku: r.iwasku,
      total_qty: Number(r.total_qty),
      last_order_date: r.last_order_date,
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows, { header: ['sku', 'iwasku', 'total_qty', 'last_order_date'] });
    ws['!cols'] = [{ wch: 30 }, { wch: 20 }, { wch: 12 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Walmart Mappings');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="walmart_mappings.xlsx"');
    res.send(buf);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

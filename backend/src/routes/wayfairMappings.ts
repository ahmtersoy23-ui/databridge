import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/database';
import { validateBody } from '../middleware/validate';
import { refreshWayfairAggregation } from '../services/sync/wayfairSync';

const router = Router();

const mappingSchema = z.object({
  part_number: z.string().min(1),
  iwasku: z.string().min(1),
});

const bulkSchema = z.object({
  mappings: z.array(mappingSchema).min(1).max(5000),
});

// GET /api/v1/wayfair/mappings?filter=all|matched|unmatched&page=1&limit=50&search=
router.get('/', async (req: Request, res: Response) => {
  try {
    const filter = (req.query.filter as string) || 'all';
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
    const search = ((req.query.search as string) || '').trim();
    const offset = (page - 1) * limit;

    let whereClause = '';
    const params: unknown[] = [];
    let paramIdx = 1;

    if (filter === 'matched') {
      whereClause = 'WHERE m.iwasku IS NOT NULL';
    } else if (filter === 'unmatched') {
      whereClause = 'WHERE m.iwasku IS NULL';
    }

    if (search) {
      const searchParam = `%${search}%`;
      if (whereClause) {
        whereClause += ` AND (wi.part_number ILIKE $${paramIdx} OR m.iwasku ILIKE $${paramIdx})`;
      } else {
        whereClause = `WHERE (wi.part_number ILIKE $${paramIdx} OR m.iwasku ILIKE $${paramIdx})`;
      }
      params.push(searchParam);
      paramIdx++;
    }

    // Join wayfair_inventory with mapping to get all part_numbers + their mapping status
    const countResult = await pool.query(`
      SELECT COUNT(DISTINCT wi.part_number) as total
      FROM wayfair_inventory wi
      LEFT JOIN wayfair_sku_mapping m ON wi.part_number = m.part_number
      ${whereClause}
    `, params);

    const total = parseInt(countResult.rows[0].total);

    const dataResult = await pool.query(`
      SELECT
        wi.part_number,
        m.iwasku,
        SUM(wi.quantity) as total_quantity,
        string_agg(wi.warehouse_id, ', ' ORDER BY wi.warehouse_id) as warehouses,
        m.updated_at as mapped_at
      FROM wayfair_inventory wi
      LEFT JOIN wayfair_sku_mapping m ON wi.part_number = m.part_number
      ${whereClause}
      GROUP BY wi.part_number, m.iwasku, m.updated_at
      ORDER BY m.iwasku IS NULL DESC, wi.part_number
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `, [...params, limit, offset]);

    res.json({
      success: true,
      data: dataResult.rows,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/wayfair/mappings — single upsert
router.post('/', validateBody(mappingSchema), async (req: Request, res: Response) => {
  const { part_number, iwasku } = req.body;
  try {
    await pool.query(`
      INSERT INTO wayfair_sku_mapping (part_number, iwasku)
      VALUES ($1, $2)
      ON CONFLICT (part_number) DO UPDATE SET iwasku = EXCLUDED.iwasku, updated_at = NOW()
    `, [part_number, iwasku]);

    // Apply mapping to wayfair_inventory immediately
    await pool.query(
      'UPDATE wayfair_inventory SET iwasku = $1 WHERE part_number = $2',
      [iwasku, part_number]
    );

    // Refresh WF aggregation in pricelab_db
    await refreshWayfairAggregation();

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/wayfair/mappings/bulk — bulk upsert
router.post('/bulk', validateBody(bulkSchema), async (req: Request, res: Response) => {
  const { mappings } = req.body as { mappings: Array<{ part_number: string; iwasku: string }> };
  try {
    const BATCH = 500;
    let upserted = 0;

    for (let i = 0; i < mappings.length; i += BATCH) {
      const batch = mappings.slice(i, i + BATCH);
      const values: string[] = [];
      const params: unknown[] = [];

      batch.forEach((m, idx) => {
        values.push(`($${idx * 2 + 1}, $${idx * 2 + 2})`);
        params.push(m.part_number, m.iwasku);
      });

      await pool.query(`
        INSERT INTO wayfair_sku_mapping (part_number, iwasku)
        VALUES ${values.join(', ')}
        ON CONFLICT (part_number) DO UPDATE SET iwasku = EXCLUDED.iwasku, updated_at = NOW()
      `, params);

      // Apply to wayfair_inventory
      for (const m of batch) {
        await pool.query(
          'UPDATE wayfair_inventory SET iwasku = $1 WHERE part_number = $2',
          [m.iwasku, m.part_number]
        );
      }

      upserted += batch.length;
    }

    // Single aggregation refresh after all batches
    const aggregated = await refreshWayfairAggregation();

    res.json({ success: true, upserted, aggregated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/v1/wayfair/mappings/:partNumber
router.delete('/:partNumber', async (req: Request, res: Response) => {
  const { partNumber } = req.params;
  try {
    await pool.query('DELETE FROM wayfair_sku_mapping WHERE part_number = $1', [partNumber]);

    // Clear iwasku from inventory row
    await pool.query(
      'UPDATE wayfair_inventory SET iwasku = NULL WHERE part_number = $1',
      [partNumber]
    );

    await refreshWayfairAggregation();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/wayfair/mappings/export — CSV download
router.get('/export', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        wi.part_number,
        COALESCE(m.iwasku, '') as iwasku,
        SUM(wi.quantity) as total_quantity
      FROM wayfair_inventory wi
      LEFT JOIN wayfair_sku_mapping m ON wi.part_number = m.part_number
      GROUP BY wi.part_number, m.iwasku
      ORDER BY wi.part_number
    `);

    const header = 'part_number,iwasku,total_quantity';
    const rows = result.rows.map((r: { part_number: string; iwasku: string; total_quantity: number }) =>
      `${r.part_number},${r.iwasku},${r.total_quantity}`
    );
    const csv = [header, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="wayfair_mappings.csv"');
    res.send(csv);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

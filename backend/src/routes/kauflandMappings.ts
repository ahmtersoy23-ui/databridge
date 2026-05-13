import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { pool } from '../config/database';
import { validateBody } from '../middleware/validate';

const router = Router();

const mappingSchema = z.object({
  account_id: z.number().int().positive(),
  marketplace_sku: z.string().min(1).max(100),
  iwasku: z.string().min(1).max(50),
});
const bulkSchema = z.object({ mappings: z.array(mappingSchema).min(1).max(5000) });

async function applyMapping(accountId: number, mpSku: string, iwasku: string): Promise<void> {
  await pool.query(
    `INSERT INTO kaufland_sku_mapping (account_id, marketplace_sku, iwasku) VALUES ($1, $2, $3)
     ON CONFLICT (account_id, marketplace_sku) DO UPDATE SET
       iwasku = EXCLUDED.iwasku, updated_at = NOW()`,
    [accountId, mpSku, iwasku],
  );
  // mp_sku may match ean OR offer_sku — back-fill both column equality paths.
  await pool.query(
    `UPDATE kaufland_raw_orders SET iwasku = $1
     WHERE account_id = $2 AND (offer_sku = $3 OR ean = $3 OR product_id_unit = $3)`,
    [iwasku, accountId, mpSku],
  );
  await pool.query(
    `UPDATE kaufland_inventory SET iwasku = $1
     WHERE account_id = $2 AND (offer_sku = $3 OR ean = $3)`,
    [iwasku, accountId, mpSku],
  );
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const filter = (req.query.filter as string) || 'all';
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
    const search = ((req.query.search as string) || '').trim();
    const accountId = req.query.accountId ? parseInt(req.query.accountId as string, 10) : null;
    const offset = (page - 1) * limit;

    // NOTE: parenthesize the OR so it doesn't bind to the iwasku filter below
    // (SQL: AND has higher precedence than OR — without parens, 'matched' filter
    // would return offer_sku-only rows even when iwasku IS NULL).
    const whereParts: string[] = ['(ko.offer_sku IS NOT NULL OR ko.ean IS NOT NULL)'];
    const params: unknown[] = [];
    let idx = 1;
    if (accountId) { whereParts.push(`ko.account_id = $${idx}`); params.push(accountId); idx++; }
    if (filter === 'matched') whereParts.push('ko.iwasku IS NOT NULL');
    else if (filter === 'unmatched') whereParts.push('ko.iwasku IS NULL');
    if (search) {
      whereParts.push(`(ko.offer_sku ILIKE $${idx} OR ko.ean ILIKE $${idx} OR ko.iwasku ILIKE $${idx} OR ko.product_title ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }
    const where = `WHERE ${whereParts.join(' AND ')}`;

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM (
         SELECT ko.account_id, ko.offer_sku, ko.ean FROM kaufland_raw_orders ko
         ${where}
         GROUP BY ko.account_id, ko.offer_sku, ko.ean, ko.iwasku
       ) sub`,
      params,
    );
    const total = parseInt(countResult.rows[0].total, 10);

    const data = await pool.query(
      `SELECT
         ko.account_id,
         COALESCE(ko.offer_sku, ko.ean) AS marketplace_sku,
         ko.offer_sku, ko.ean, ko.iwasku,
         (array_agg(ko.product_title ORDER BY ko.order_date_local DESC) FILTER (WHERE ko.product_title IS NOT NULL))[1] AS product_title,
         SUM(ko.quantity)::int AS total_qty,
         MAX(ko.order_date_local) AS last_order_date,
         m.updated_at AS mapped_at
       FROM kaufland_raw_orders ko
       LEFT JOIN kaufland_sku_mapping m
         ON m.account_id = ko.account_id
        AND m.marketplace_sku = COALESCE(ko.offer_sku, ko.ean)
       ${where}
       GROUP BY ko.account_id, ko.offer_sku, ko.ean, ko.iwasku, m.updated_at
       ORDER BY (ko.iwasku IS NULL) DESC, COALESCE(ko.offer_sku, ko.ean)
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
  const { account_id, marketplace_sku, iwasku } = req.body;
  try { await applyMapping(account_id, marketplace_sku, iwasku); res.json({ success: true }); }
  catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/bulk', validateBody(bulkSchema), async (req: Request, res: Response) => {
  const { mappings } = req.body as { mappings: Array<{ account_id: number; marketplace_sku: string; iwasku: string }> };
  try {
    let upserted = 0;
    for (const m of mappings) { await applyMapping(m.account_id, m.marketplace_sku, m.iwasku); upserted++; }
    res.json({ success: true, upserted });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

router.delete('/:accountId/:sku', async (req: Request, res: Response) => {
  const accountId = parseInt(req.params.accountId, 10);
  const sku = req.params.sku;
  try {
    await pool.query('DELETE FROM kaufland_sku_mapping WHERE account_id = $1 AND marketplace_sku = $2', [accountId, sku]);
    await pool.query(
      `UPDATE kaufland_raw_orders SET iwasku = NULL
       WHERE account_id = $1 AND (offer_sku = $2 OR ean = $2 OR product_id_unit = $2)`,
      [accountId, sku],
    );
    await pool.query(
      `UPDATE kaufland_inventory SET iwasku = NULL
       WHERE account_id = $1 AND (offer_sku = $2 OR ean = $2)`,
      [accountId, sku],
    );
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/export', async (req: Request, res: Response) => {
  try {
    const accountId = req.query.accountId ? parseInt(req.query.accountId as string, 10) : null;
    const params: unknown[] = [];
    let where = 'WHERE (ko.offer_sku IS NOT NULL OR ko.ean IS NOT NULL)';
    if (accountId) { where += ` AND ko.account_id = $1`; params.push(accountId); }

    const result = await pool.query(
      `SELECT ko.account_id,
              COALESCE(ko.offer_sku, ko.ean) AS marketplace_sku,
              ko.offer_sku, ko.ean,
              COALESCE(ko.iwasku, '') AS iwasku,
              SUM(ko.quantity)::int AS total_qty,
              MAX(ko.order_date_local) AS last_order_date
       FROM kaufland_raw_orders ko
       ${where}
       GROUP BY ko.account_id, ko.offer_sku, ko.ean, ko.iwasku
       ORDER BY ko.account_id, COALESCE(ko.offer_sku, ko.ean)`,
      params,
    );
    const rows = result.rows.map((r: any) => ({
      account_id: r.account_id,
      marketplace_sku: r.marketplace_sku,
      offer_sku: r.offer_sku,
      ean: r.ean,
      iwasku: r.iwasku,
      total_qty: Number(r.total_qty),
      last_order_date: r.last_order_date,
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows, {
      header: ['account_id', 'marketplace_sku', 'offer_sku', 'ean', 'iwasku', 'total_qty', 'last_order_date'],
    });
    ws['!cols'] = [{ wch: 10 }, { wch: 20 }, { wch: 20 }, { wch: 18 }, { wch: 20 }, { wch: 10 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Kaufland Mappings');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="kaufland_mappings.xlsx"');
    res.send(buf);
  } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
});

export default router;

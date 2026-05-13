import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/database';
import { validateBody } from '../middleware/validate';
import { getAccountById, takealotGet, type TakealotAccount } from '../services/takealot/client';
import { encryptCredential } from '../utils/crypto';

const router = Router();

const credSchema = z.object({
  label: z.string().min(1).max(50),
  api_key: z.string().optional(),
});

router.get('/', async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, label, is_active, created_at, updated_at FROM takealot_credentials ORDER BY id`,
    );
    res.json({ accounts: r.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', validateBody(credSchema), async (req: Request, res: Response) => {
  const { label, api_key } = req.body;
  try {
    if (!api_key) {
      res.status(400).json({ success: false, error: 'api_key is required' });
      return;
    }
    const encrypted = encryptCredential(api_key);
    const r = await pool.query(
      `INSERT INTO takealot_credentials (label, api_key)
       VALUES ($1, $2)
       ON CONFLICT (label) DO UPDATE SET
         api_key = EXCLUDED.api_key, updated_at = NOW()
       RETURNING id`,
      [label, encrypted],
    );
    res.json({ success: true, id: r.rows[0].id });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { label, api_key, is_active } = req.body;
  try {
    const fields: string[] = [];
    const params: unknown[] = [id];
    let idx = 2;
    if (label !== undefined) { fields.push(`label = $${idx}`); params.push(label); idx++; }
    if (api_key) { fields.push(`api_key = $${idx}`); params.push(encryptCredential(api_key)); idx++; }
    if (is_active !== undefined) { fields.push(`is_active = $${idx}`); params.push(is_active); idx++; }
    if (fields.length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update' });
      return;
    }
    fields.push('updated_at = NOW()');
    await pool.query(`UPDATE takealot_credentials SET ${fields.join(', ')} WHERE id = $1`, params);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM takealot_credentials WHERE id = $1', [parseInt(req.params.id, 10)]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /:id/test — probe /v2/sales with 1-day window, 1 result
router.post('/:id/test', async (req: Request, res: Response) => {
  try {
    const account: TakealotAccount = await getAccountById(parseInt(req.params.id, 10));
    const today = new Date().toISOString().slice(0, 10);
    interface Probe { sales?: unknown[]; page_summary?: { total?: number } }
    const resp = await takealotGet<Probe>(account, '/v2/sales', {
      params: { filters: `start_date:${today};end_date:${today}`, page_size: 1 },
    });
    const total = resp.page_summary?.total ?? resp.sales?.length ?? 0;
    res.json({
      success: true,
      message: `Connection OK — today total: ${total} sales (auth scheme works)`,
    });
  } catch (err: any) {
    const status = err.response?.status;
    let hint = '';
    if (status === 401) hint = ' — auth scheme yanlış olabilir (TAKEALOT_AUTH_SCHEME=Bearer dene)';
    res.status(400).json({ success: false, error: (err.message || 'failed') + hint });
  }
});

export default router;

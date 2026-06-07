import { Router, Request, Response } from 'express';
import { errMessage } from '../utils/errors';
import { z } from 'zod';
import { pool } from '../config/database';
import { validateBody } from '../middleware/validate';
import {
  clearWalmartTokenCache,
  getAccountById,
  walmartGet,
  type WalmartAccount,
} from '../services/walmart/client';
import { encryptCredential } from '../utils/crypto';

const router = Router();

const credSchema = z.object({
  label: z.string().min(1).max(50),
  client_id: z.string().min(1),
  client_secret: z.string().optional(),
  use_sandbox: z.boolean().default(false),
});

// GET /api/v1/walmart/settings — list all accounts
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, label, client_id, use_sandbox, is_active, created_at, updated_at
       FROM walmart_credentials ORDER BY id`,
    );
    res.json({ accounts: result.rows });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: errMessage(err) });
  }
});

// POST /api/v1/walmart/settings — create or update account
router.post('/', validateBody(credSchema), async (req: Request, res: Response) => {
  const { label, client_id, client_secret, use_sandbox } = req.body;
  try {
    if (!client_secret) {
      res.status(400).json({ success: false, error: 'client_secret is required' });
      return;
    }
    const encryptedSecret = encryptCredential(client_secret);
    const result = await pool.query(
      `INSERT INTO walmart_credentials (label, client_id, client_secret, use_sandbox)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (label) DO UPDATE SET
         client_id = EXCLUDED.client_id,
         client_secret = EXCLUDED.client_secret,
         use_sandbox = EXCLUDED.use_sandbox,
         updated_at = NOW()
       RETURNING id`,
      [label, client_id, encryptedSecret, use_sandbox],
    );

    clearWalmartTokenCache(result.rows[0].id);
    res.json({ success: true, id: result.rows[0].id });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: errMessage(err) });
  }
});

// PUT /api/v1/walmart/settings/:id — partial update
router.put('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { label, client_id, client_secret, use_sandbox, is_active } = req.body;
  try {
    const fields: string[] = [];
    const params: unknown[] = [id];
    let idx = 2;

    if (label !== undefined) { fields.push(`label = $${idx}`); params.push(label); idx++; }
    if (client_id !== undefined) { fields.push(`client_id = $${idx}`); params.push(client_id); idx++; }
    if (client_secret) {
      fields.push(`client_secret = $${idx}`);
      params.push(encryptCredential(client_secret));
      idx++;
    }
    if (use_sandbox !== undefined) { fields.push(`use_sandbox = $${idx}`); params.push(use_sandbox); idx++; }
    if (is_active !== undefined) { fields.push(`is_active = $${idx}`); params.push(is_active); idx++; }

    if (fields.length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update' });
      return;
    }

    fields.push('updated_at = NOW()');
    await pool.query(
      `UPDATE walmart_credentials SET ${fields.join(', ')} WHERE id = $1`,
      params,
    );
    clearWalmartTokenCache(id);
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: errMessage(err) });
  }
});

// DELETE /api/v1/walmart/settings/:id
router.delete('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  try {
    await pool.query('DELETE FROM walmart_credentials WHERE id = $1', [id]);
    clearWalmartTokenCache(id);
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: errMessage(err) });
  }
});

// POST /api/v1/walmart/settings/:id/test — test connection by fetching 1 order
router.post('/:id/test', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const account: WalmartAccount = await getAccountById(id);

    // Probe — request 1 order from yesterday to confirm token + auth works
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    interface ProbeResp {
      list?: { meta?: { totalCount?: number }; elements?: { order?: unknown[] } };
    }
    const resp = await walmartGet<ProbeResp>(account, '/v3/orders', {
      params: { createdStartDate: yesterday, limit: 1 },
    });

    const orderCount = resp.list?.elements?.order?.length ?? 0;
    res.json({
      success: true,
      sandbox: account.use_sandbox,
      message: `Connection successful (probe returned ${orderCount} order${orderCount === 1 ? '' : 's'})`,
    });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: errMessage(err) });
  }
});

export default router;

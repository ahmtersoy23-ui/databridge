import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/database';
import { validateBody } from '../middleware/validate';
import {
  clearBolTokenCache,
  getAccountById,
  bolGet,
  type BolAccount,
} from '../services/bol/client';
import { encryptCredential } from '../utils/crypto';

const router = Router();

const credSchema = z.object({
  label: z.string().min(1).max(50),
  client_id: z.string().min(1),
  client_secret: z.string().optional(),
  channel: z.string().min(1).max(20),
  use_sandbox: z.boolean().default(false),
});

// GET /api/v1/bol/settings — list all accounts
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, label, client_id, channel, use_sandbox, is_active, created_at, updated_at
       FROM bol_credentials ORDER BY id`,
    );
    res.json({ accounts: result.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/bol/settings — create or update by label
router.post('/', validateBody(credSchema), async (req: Request, res: Response) => {
  const { label, client_id, client_secret, channel, use_sandbox } = req.body;
  try {
    if (!client_secret) {
      res.status(400).json({ success: false, error: 'client_secret is required' });
      return;
    }
    const encrypted = encryptCredential(client_secret);
    const result = await pool.query(
      `INSERT INTO bol_credentials (label, client_id, client_secret, channel, use_sandbox)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (label) DO UPDATE SET
         client_id = EXCLUDED.client_id,
         client_secret = EXCLUDED.client_secret,
         channel = EXCLUDED.channel,
         use_sandbox = EXCLUDED.use_sandbox,
         updated_at = NOW()
       RETURNING id`,
      [label, client_id, encrypted, channel, use_sandbox],
    );
    clearBolTokenCache(result.rows[0].id);
    res.json({ success: true, id: result.rows[0].id });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/v1/bol/settings/:id — partial update
router.put('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { label, client_id, client_secret, channel, use_sandbox, is_active } = req.body;
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
    if (channel !== undefined) { fields.push(`channel = $${idx}`); params.push(channel); idx++; }
    if (use_sandbox !== undefined) { fields.push(`use_sandbox = $${idx}`); params.push(use_sandbox); idx++; }
    if (is_active !== undefined) { fields.push(`is_active = $${idx}`); params.push(is_active); idx++; }

    if (fields.length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update' });
      return;
    }
    fields.push('updated_at = NOW()');
    await pool.query(
      `UPDATE bol_credentials SET ${fields.join(', ')} WHERE id = $1`,
      params,
    );
    clearBolTokenCache(id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/v1/bol/settings/:id
router.delete('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  try {
    await pool.query('DELETE FROM bol_credentials WHERE id = $1', [id]);
    clearBolTokenCache(id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/bol/settings/:id/test — token + 1 order probe
router.post('/:id/test', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const account: BolAccount = await getAccountById(id);

    interface ProbeResp { orders?: unknown[] }
    const resp = await bolGet<ProbeResp>(account, '/orders', {
      params: { page: 1, status: 'ALL', 'fulfilment-method': 'FBR' },
    });

    const count = resp.orders?.length ?? 0;
    res.json({
      success: true,
      message: `Connection OK — Production, ${account.channel} (probe returned ${count} order${count === 1 ? '' : 's'})`,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/database';
import { validateBody } from '../middleware/validate';
import { getAccountById, testConnection } from '../services/kaufland/client';
import { encryptCredential } from '../utils/crypto';

const router = Router();

const credSchema = z.object({
  label: z.string().min(1).max(50),
  client_key: z.string().optional(),
  secret_key: z.string().optional(),
  storefront: z.string().min(2).max(10).optional(),
  channel: z.string().min(2).max(30).optional(),
});

router.get('/', async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, label, client_key, storefront, channel, is_active, created_at, updated_at
       FROM kaufland_credentials ORDER BY id`,
    );
    res.json({ accounts: r.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', validateBody(credSchema), async (req: Request, res: Response) => {
  const { label, client_key, secret_key, storefront, channel } = req.body;
  try {
    if (!client_key || !secret_key) {
      res.status(400).json({ success: false, error: 'client_key and secret_key are required' });
      return;
    }
    const encrypted = encryptCredential(secret_key);
    const r = await pool.query(
      `INSERT INTO kaufland_credentials (label, client_key, secret_key, storefront, channel)
       VALUES ($1, $2, $3, COALESCE($4, 'de_DE'), COALESCE($5, 'kaufland_de'))
       ON CONFLICT (label) DO UPDATE SET
         client_key = EXCLUDED.client_key,
         secret_key = EXCLUDED.secret_key,
         storefront = EXCLUDED.storefront,
         channel    = EXCLUDED.channel,
         updated_at = NOW()
       RETURNING id`,
      [label, client_key, encrypted, storefront ?? null, channel ?? null],
    );
    res.json({ success: true, id: r.rows[0].id });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { label, client_key, secret_key, storefront, channel, is_active } = req.body;
  try {
    const fields: string[] = [];
    const params: unknown[] = [id];
    let idx = 2;
    if (label !== undefined)      { fields.push(`label = $${idx}`); params.push(label); idx++; }
    if (client_key !== undefined) { fields.push(`client_key = $${idx}`); params.push(client_key); idx++; }
    if (secret_key)               { fields.push(`secret_key = $${idx}`); params.push(encryptCredential(secret_key)); idx++; }
    if (storefront !== undefined) { fields.push(`storefront = $${idx}`); params.push(storefront); idx++; }
    if (channel !== undefined)    { fields.push(`channel = $${idx}`); params.push(channel); idx++; }
    if (is_active !== undefined)  { fields.push(`is_active = $${idx}`); params.push(is_active); idx++; }
    if (fields.length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update' });
      return;
    }
    fields.push('updated_at = NOW()');
    await pool.query(`UPDATE kaufland_credentials SET ${fields.join(', ')} WHERE id = $1`, params);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM kaufland_credentials WHERE id = $1', [parseInt(req.params.id, 10)]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/:id/test', async (req: Request, res: Response) => {
  try {
    const account = await getAccountById(parseInt(req.params.id, 10));
    const result = await testConnection(account);
    res.json({
      success: true,
      message: `Connection OK — total orders: ${result.orderCount} (storefront=${account.storefront})`,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'failed' });
  }
});

export default router;

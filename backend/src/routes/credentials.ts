import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/database';
import { authMiddleware } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { clearClientCache } from '../services/spApi/client';
import logger from '../config/logger';

const router = Router();

const credentialSchema = z.object({
  region: z.enum(['NA', 'EU', 'FE']),
  seller_id: z.string().min(1),
  refresh_token: z.string().min(1),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  account_name: z.string().optional().default(''),
});

// GET /api/v1/credentials - List credentials (masked)
router.get('/', authMiddleware, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT id, region, seller_id, account_name, is_active, created_at, updated_at,
             CONCAT(LEFT(refresh_token, 8), '...') as refresh_token_preview,
             CONCAT(LEFT(client_id, 12), '...') as client_id_preview
      FROM sp_api_credentials
      ORDER BY region
    `);
    res.json({ success: true, data: result.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/credentials - Add credentials
router.post('/', authMiddleware, validateBody(credentialSchema), async (req: Request, res: Response) => {
  const { region, seller_id, refresh_token, client_id, client_secret, account_name } = req.body;

  try {
    const result = await pool.query(`
      INSERT INTO sp_api_credentials (region, seller_id, refresh_token, client_id, client_secret, account_name)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, region, seller_id, account_name, is_active, created_at
    `, [region, seller_id, refresh_token, client_id, client_secret, account_name || '']);

    // Clear cached SP-API clients
    clearClientCache();

    logger.info(`[Credentials] Added credentials for region: ${region} (${account_name || 'unnamed'})`);
    res.json({ success: true, data: result.rows[0] });
  } catch (err: any) {
    logger.error('[Credentials] Error saving:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/v1/credentials/:id - Update credentials
const updateSchema = z.object({
  region: z.enum(['NA', 'EU', 'FE']).optional(),
  seller_id: z.string().min(1).optional(),
  refresh_token: z.string().min(1).optional(),
  client_id: z.string().min(1).optional(),
  client_secret: z.string().min(1).optional(),
  account_name: z.string().optional(),
});

router.put('/:id', authMiddleware, validateBody(updateSchema), async (req: Request, res: Response) => {
  const { id } = req.params;
  const fields = req.body;

  const setClauses: string[] = [];
  const values: any[] = [];
  let idx = 1;

  for (const [key, val] of Object.entries(fields)) {
    if (val !== undefined && val !== '') {
      setClauses.push(`${key} = $${idx}`);
      values.push(val);
      idx++;
    }
  }

  if (setClauses.length === 0) {
    res.status(400).json({ success: false, error: 'No fields to update' });
    return;
  }

  setClauses.push(`updated_at = NOW()`);
  values.push(id);

  try {
    const result = await pool.query(
      `UPDATE sp_api_credentials SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING id, region, seller_id, is_active`,
      values
    );

    if (result.rowCount === 0) {
      res.status(404).json({ success: false, error: 'Credential not found' });
      return;
    }

    clearClientCache();
    logger.info(`[Credentials] Updated credential id: ${id}`);
    res.json({ success: true, data: result.rows[0] });
  } catch (err: any) {
    logger.error('[Credentials] Error updating:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/v1/credentials/:id/toggle - Toggle active status
router.patch('/:id/toggle', authMiddleware, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'UPDATE sp_api_credentials SET is_active = NOT is_active, updated_at = NOW() WHERE id = $1 RETURNING id, region, seller_id, account_name, is_active',
      [req.params.id]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ success: false, error: 'Credential not found' });
      return;
    }
    clearClientCache();
    const cred = result.rows[0];
    logger.info(`[Credentials] Toggled credential ${cred.id} (${cred.account_name}): is_active=${cred.is_active}`);
    res.json({ success: true, data: cred });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/v1/credentials/:id - Deactivate credentials
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    await pool.query(
      'UPDATE sp_api_credentials SET is_active = false, updated_at = NOW() WHERE id = $1',
      [req.params.id]
    );
    clearClientCache();
    res.json({ success: true, message: 'Credentials deactivated' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

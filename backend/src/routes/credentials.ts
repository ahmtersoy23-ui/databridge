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
});

// GET /api/v1/credentials - List credentials (masked)
router.get('/', authMiddleware, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT id, region, seller_id, is_active, created_at, updated_at,
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

// POST /api/v1/credentials - Add/update credentials
router.post('/', authMiddleware, validateBody(credentialSchema), async (req: Request, res: Response) => {
  const { region, seller_id, refresh_token, client_id, client_secret } = req.body;

  try {
    // Deactivate existing credentials for this region
    await pool.query(
      'UPDATE sp_api_credentials SET is_active = false WHERE region = $1',
      [region]
    );

    const result = await pool.query(`
      INSERT INTO sp_api_credentials (region, seller_id, refresh_token, client_id, client_secret)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, region, seller_id, is_active, created_at
    `, [region, seller_id, refresh_token, client_id, client_secret]);

    // Clear cached SP-API clients
    clearClientCache();

    logger.info(`[Credentials] Added credentials for region: ${region}`);
    res.json({ success: true, data: result.rows[0] });
  } catch (err: any) {
    logger.error('[Credentials] Error saving:', err.message);
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

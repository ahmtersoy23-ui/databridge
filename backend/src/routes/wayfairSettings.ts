import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/database';
import { validateBody } from '../middleware/validate';
import { clearWayfairTokenCache, getCredentials, getApiBase, graphqlQuery } from '../services/wayfair/client';

const router = Router();

const credSchema = z.object({
  client_id: z.string().min(1),
  client_secret: z.string().optional(),
  use_sandbox: z.boolean().default(true),
});

// GET /api/v1/wayfair/settings
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT client_id, use_sandbox, updated_at FROM wayfair_credentials WHERE id = 1'
    );
    if (!result.rows.length) {
      res.json({ configured: false });
      return;
    }
    res.json({ configured: true, ...result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/wayfair/settings
router.post('/', validateBody(credSchema), async (req: Request, res: Response) => {
  const { client_id, client_secret, use_sandbox } = req.body;
  try {
    if (client_secret) {
      await pool.query(`
        INSERT INTO wayfair_credentials (id, client_id, client_secret, use_sandbox)
        VALUES (1, $1, $2, $3)
        ON CONFLICT (id) DO UPDATE SET
          client_id = EXCLUDED.client_id,
          client_secret = EXCLUDED.client_secret,
          use_sandbox = EXCLUDED.use_sandbox,
          updated_at = NOW()
      `, [client_id, client_secret, use_sandbox]);
    } else {
      await pool.query(`
        INSERT INTO wayfair_credentials (id, client_id, client_secret, use_sandbox)
        VALUES (1, $1, '', $2)
        ON CONFLICT (id) DO UPDATE SET
          client_id = EXCLUDED.client_id,
          use_sandbox = EXCLUDED.use_sandbox,
          updated_at = NOW()
      `, [client_id, use_sandbox]);
    }

    clearWayfairTokenCache();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/wayfair/settings/test — test token fetch
router.post('/test', async (_req: Request, res: Response) => {
  try {
    const creds = await getCredentials();
    const apiBase = getApiBase(creds.use_sandbox);

    // Simple introspection query to verify connectivity
    const result = await graphqlQuery<{ __typename: string }>(`{ __typename }`);
    res.json({
      success: true,
      sandbox: creds.use_sandbox,
      apiBase,
      message: 'Connection successful',
      typename: result,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

export default router;

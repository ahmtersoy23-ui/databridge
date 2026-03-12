import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/database';
import { validateBody } from '../middleware/validate';
import { clearWisersellTokenCache } from '../services/sync/wisersellSync';
import { encryptCredential } from '../utils/crypto';

const router = Router();

const credSchema = z.object({
  email: z.string().email(),
  password: z.string().optional(),
  api_url: z.string().url(),
});

// GET /api/v1/wisersell-settings — returns current config (no password)
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT email, api_url, updated_at FROM wisersell_credentials WHERE id = 1'
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

// POST /api/v1/wisersell-settings — save/update credentials
router.post('/', validateBody(credSchema), async (req: Request, res: Response) => {
  const { email, password, api_url } = req.body;
  try {
    if (password) {
      // Full upsert including password (encrypted at rest)
      const encryptedPassword = encryptCredential(password);
      await pool.query(`
        INSERT INTO wisersell_credentials (id, email, password, api_url)
        VALUES (1, $1, $2, $3)
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          password = EXCLUDED.password,
          api_url = EXCLUDED.api_url,
          updated_at = NOW()
      `, [email, encryptedPassword, api_url]);
    } else {
      // Update email + api_url only, keep existing password
      await pool.query(`
        INSERT INTO wisersell_credentials (id, email, password, api_url)
        VALUES (1, $1, '', $2)
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          api_url = EXCLUDED.api_url,
          updated_at = NOW()
      `, [email, api_url]);
    }

    clearWisersellTokenCache();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate';
import { adminOpsAuth } from '../middleware/adminOps';
import { pushListingQuantities } from '../services/spApi/listingsPush';
import { pool } from '../config/database';
import { errMessage } from '../utils/errors';
import { notify } from '../utils/notify';
import logger from '../config/logger';

/**
 * Amazon Listings stok push — ManuMaestro (server-to-server, x-internal-api-key) cagirir.
 * SP-API ile konusan TEK yer DataBridge (Veeqo kalibi).
 *
 *   POST /amazon-listings/push  { country, dryRun?, items:[{sku,quantity}] }
 *     -> her FBM seller SKU'su icin available'i hedefe getirir (diff-based).
 *
 * Cagiran sadece amazon_fbm SKU gonderir; FBA'ya dokunulmaz. Hesap ulke->credential
 * map'inden (US = MDN/NA cred 1).
 */

const router = Router();
router.use(adminOpsAuth);

const CRED_BY_COUNTRY: Record<string, number> = {
  US: 1, // MDN / NA
};

const pushSchema = z.object({
  country: z.string().default('US'),
  dryRun: z.boolean().optional(),
  /** Verilirse + dryRun degilse Slack'e dusurulur (cagiran: Tier-A 0'a inenler). */
  alert: z.string().max(2000).optional(),
  items: z
    .array(z.object({ sku: z.string().min(1), quantity: z.number().int().min(0) }))
    .min(1)
    .max(5000),
});

router.post('/push', validateBody(pushSchema), async (req: Request, res: Response) => {
  const { country, dryRun, alert, items } = req.body as z.infer<typeof pushSchema>;
  const credId = CRED_BY_COUNTRY[country.toUpperCase()];
  if (!credId) {
    res.status(400).json({ success: false, error: `Desteklenmeyen ulke: ${country}` });
    return;
  }
  try {
    const results = await pushListingQuantities(credId, country.toUpperCase(), items, { dryRun: !!dryRun });
    const summary = {
      total: results.length,
      pushed: results.filter((r) => r.status === 'pushed').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      dryrun: results.filter((r) => r.status === 'dryrun').length,
      failed: results.filter((r) => r.status === 'failed').length,
    };
    await pool
      .query(
        `INSERT INTO sync_log (job_name, status, rows_processed, error_message, detail, finished_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          `amazon-fbm-push${dryRun ? '-dryrun' : ''}`,
          summary.failed > 0 ? 'failed' : 'success',
          summary.pushed,
          summary.failed ? `${summary.failed} sku basarisiz` : null,
          JSON.stringify(summary).slice(0, 300),
        ],
      )
      .catch(() => {
        /* audit log akisi bozmasin */
      });
    logger.info(`[amazon-listings/push] ${country} dryRun=${!!dryRun} ${JSON.stringify(summary)}`);
    if (alert && !dryRun) {
      await notify(`🟠 Amazon FBM stok push — ${alert}`).catch(() => {
        /* alarm hatasi akisi bozmasin */
      });
    }
    res.json({ success: true, dryRun: !!dryRun, summary, results });
  } catch (err) {
    logger.error(`[amazon-listings/push] ${errMessage(err)}`);
    res.status(500).json({ success: false, error: errMessage(err) });
  }
});

export default router;

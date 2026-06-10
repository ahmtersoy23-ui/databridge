import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate';
import { adminOpsAuth } from '../middleware/adminOps';
import { pushWalmartInventory } from '../services/walmart/inventoryPush';
import { pool } from '../config/database';
import { errMessage } from '../utils/errors';
import { notify } from '../utils/notify';
import logger from '../config/logger';

/**
 * Walmart stok push — ManuMaestro (server-to-server, x-internal-api-key).
 *   POST /walmart-listings/push  { dryRun?, alert?, items:[{sku,quantity}] }
 * Walmart Inventory API (PUT /v3/inventory), tek US hesabı. Amazon /amazon-listings
 * ile aynı kalıp; çağıran sadece seller-fulfilled PUBLISHED SKU gönderir.
 */

const router = Router();
router.use(adminOpsAuth);

const pushSchema = z.object({
  dryRun: z.boolean().optional(),
  alert: z.string().max(2000).optional(),
  items: z
    .array(z.object({ sku: z.string().min(1), quantity: z.number().int().min(0) }))
    .min(1)
    .max(5000),
});

router.post('/push', validateBody(pushSchema), async (req: Request, res: Response) => {
  const { dryRun, alert, items } = req.body as z.infer<typeof pushSchema>;
  try {
    const results = await pushWalmartInventory(items, { dryRun: !!dryRun });
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
          `walmart-inv-push${dryRun ? '-dryrun' : ''}`,
          summary.failed > 0 ? 'failed' : 'success',
          summary.pushed,
          summary.failed ? `${summary.failed} sku basarisiz` : null,
          JSON.stringify(summary).slice(0, 300),
        ],
      )
      .catch(() => {
        /* audit log akışı bozmasın */
      });
    logger.info(`[walmart-listings/push] dryRun=${!!dryRun} ${JSON.stringify(summary)}`);
    if (alert && !dryRun) {
      await notify(`🟠 Walmart stok push — ${alert}`).catch(() => {});
    }
    res.json({ success: true, dryRun: !!dryRun, summary, results });
  } catch (err) {
    logger.error(`[walmart-listings/push] ${errMessage(err)}`);
    res.status(500).json({ success: false, error: errMessage(err) });
  }
});

export default router;

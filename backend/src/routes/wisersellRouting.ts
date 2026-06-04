import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/database';
import { validateBody } from '../middleware/validate';
import { adminOpsAuth } from '../middleware/adminOps';
import { markOrdersStatus, closeExternalOrder } from '../services/wisersell/webClient';
import { WISERSELL_STATUS_CODES } from '../config/constants';
import logger from '../config/logger';

/**
 * Wisersell routing yazma uçları — ManuMaestro (server-to-server, x-internal-api-key)
 * veya admin UI (SSO admin) çağırır. İki yönlü otomasyonun Wisersell'e YAZMA tarafı:
 *   POST /mark-ready  → status/update (Kargoya Hazır = 11), ids[] toplu
 *   POST /close       → external-close/{id} (tracking ile kapat)
 *
 * Wisersell ile konuşan TEK yer DataBridge (web token burada). ManuMaestro iş mantığını
 * yapar, bu uçları tetikler.
 */

const router = Router();
router.use(adminOpsAuth);

async function auditLog(jobName: string, status: 'success' | 'failed', rows: number, error?: string): Promise<void> {
  await pool.query(
    `INSERT INTO sync_log (job_name, status, rows_processed, error_message, finished_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [jobName, status, rows, error?.slice(0, 500) ?? null],
  ).catch(() => { /* audit log hatası akışı bozmasın */ });
}

const markReadySchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(200),
});

// POST /api/wisersell-routing/mark-ready  { ids: [299136, ...] }
router.post('/mark-ready', validateBody(markReadySchema), async (req: Request, res: Response) => {
  const { ids } = req.body as { ids: number[] };
  const readyStatus = WISERSELL_STATUS_CODES.ready_to_ship[0]; // 11
  try {
    const affected = await markOrdersStatus(ids, readyStatus);
    await auditLog('wisersell-routing-mark-ready', 'success', affected.length);
    logger.info(`[WisersellRouting] mark-ready OK: ${affected.length}/${ids.length} → status ${readyStatus}`);
    res.json({ success: true, affected, count: affected.length });
  } catch (err: any) {
    await auditLog('wisersell-routing-mark-ready', 'failed', 0, err.message);
    logger.error('[WisersellRouting] mark-ready error:', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

const closeSchema = z.object({
  orderId: z.number().int().positive(),
  carrierId: z.number().int().positive(),
  trackingCode: z.string().min(1),
});

// POST /api/wisersell-routing/close  { orderId, carrierId, trackingCode }
router.post('/close', validateBody(closeSchema), async (req: Request, res: Response) => {
  const { orderId, carrierId, trackingCode } = req.body as { orderId: number; carrierId: number; trackingCode: string };
  try {
    await closeExternalOrder(orderId, carrierId, trackingCode);
    await auditLog('wisersell-routing-close', 'success', 1);
    logger.info(`[WisersellRouting] external-close OK: order ${orderId} (carrier ${carrierId}, ${trackingCode})`);
    res.json({ success: true, orderId });
  } catch (err: any) {
    await auditLog('wisersell-routing-close', 'failed', 0, err.message);
    logger.error('[WisersellRouting] close error:', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

export default router;

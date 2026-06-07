import { Router, Request, Response } from 'express';
import { errMessage } from '../utils/errors';
import { z } from 'zod';
import { validateBody } from '../middleware/validate';
import { adminOpsAuth } from '../middleware/adminOps';
import { fetchOrderStatusesByIds, fetchCanceledOrdersSince } from '../services/spApi/orderStatus';
import logger from '../config/logger';

/**
 * Amazon sipariş durumu okuma uçları — ManuMaestro (server-to-server,
 * x-internal-api-key) veya admin UI çağırır. Wisersell'e iptali yansımayan
 * Amazon siparişlerini yakalamak için. Sadece OKUR.
 *
 *   POST /by-ids         { amazonOrderIds[] }  → { statuses: { id: OrderStatus } }
 *   POST /canceled-since { since: ISO }         → { canceled: string[] }
 */

const router = Router();
router.use(adminOpsAuth);

const byIdsSchema = z.object({
  amazonOrderIds: z.array(z.string().min(1)).min(1).max(100),
});

// POST /api/amazon-order-status/by-ids  { amazonOrderIds: ["111-...", ...] }
router.post('/by-ids', validateBody(byIdsSchema), async (req: Request, res: Response) => {
  const { amazonOrderIds } = req.body as { amazonOrderIds: string[] };
  try {
    const statuses = await fetchOrderStatusesByIds(amazonOrderIds);
    res.json({ success: true, statuses });
  } catch (err: unknown) {
    logger.error('[AmazonOrderStatus] by-ids error:', errMessage(err));
    res.status(502).json({ success: false, error: errMessage(err) });
  }
});

const canceledSinceSchema = z.object({
  since: z.string().min(1),
});

// POST /api/amazon-order-status/canceled-since  { since: "2026-06-06T12:00:00Z" }
router.post('/canceled-since', validateBody(canceledSinceSchema), async (req: Request, res: Response) => {
  const since = new Date((req.body as { since: string }).since);
  if (isNaN(since.getTime())) {
    res.status(400).json({ success: false, error: 'Invalid since timestamp' });
    return;
  }
  try {
    const canceled = await fetchCanceledOrdersSince(since);
    res.json({ success: true, canceled: [...canceled] });
  } catch (err: unknown) {
    logger.error('[AmazonOrderStatus] canceled-since error:', errMessage(err));
    res.status(502).json({ success: false, error: errMessage(err) });
  }
});

export default router;

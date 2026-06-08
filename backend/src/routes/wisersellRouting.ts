import { Router, Request, Response } from 'express';
import { errMessage } from '../utils/errors';
import { z } from 'zod';
import { pool } from '../config/database';
import { validateBody } from '../middleware/validate';
import { adminOpsAuth } from '../middleware/adminOps';
import { markOrdersStatus, markOrderItemsStatus, closeExternalOrder, platformCloseOrder, cancelOrder } from '../services/wisersell/webClient';
import { refreshWayfairAggregation } from '../services/sync/wayfairSync';
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
  } catch (err: unknown) {
    await auditLog('wisersell-routing-mark-ready', 'failed', 0, errMessage(err));
    logger.error('[WisersellRouting] mark-ready error:', errMessage(err));
    res.status(502).json({ success: false, error: errMessage(err) });
  }
});

// POST /api/wisersell-routing/reopen  { ids: [299136, ...] }
// "Kargoya Hazır"ı geri al → Wisersell'de "açık" (status open=2) + routing candidate'ı
// yeniden görünür kıl (gone_at=NULL). ManuMaestro "Açık Siparişe Geri Al" akışı.
router.post('/reopen', validateBody(markReadySchema), async (req: Request, res: Response) => {
  const { ids } = req.body as { ids: number[] };
  const openStatus = WISERSELL_STATUS_CODES.open[0]; // 2
  try {
    const affected = await markOrdersStatus(ids, openStatus);
    // Candidate'ı Onay Bekliyor'a geri getir (poll'u beklemeden)
    const upd = await pool.query(
      `UPDATE wisersell_routing_candidates SET gone_at = NULL
       WHERE wisersell_order_id = ANY($1::bigint[]) AND gone_at IS NOT NULL`,
      [ids],
    );
    await auditLog('wisersell-routing-reopen', 'success', affected.length);
    logger.info(`[WisersellRouting] reopen OK: ${affected.length}/${ids.length} → status ${openStatus} (candidate gone_at temizlendi: ${upd.rowCount})`);
    res.json({ success: true, affected, count: affected.length, candidatesRevived: upd.rowCount ?? 0 });
  } catch (err: unknown) {
    await auditLog('wisersell-routing-reopen', 'failed', 0, errMessage(err));
    logger.error('[WisersellRouting] reopen error:', errMessage(err));
    res.status(502).json({ success: false, error: errMessage(err) });
  }
});

// Orderitem ÜRETİM durumu (Üretim/Tedarik pipeline): Yeni=1, Beklemede=5, Teslim Edildi=6.
const orderItemStatusSchema = z.object({
  itemIds: z.array(z.number().int().positive()).min(1).max(200),
  statusId: z.union([z.literal(1), z.literal(5), z.literal(6)]),
});

// POST /api/wisersell-routing/orderitem-status  { itemIds: [365577, ...], statusId: 5 }
// US-depo siparişini üretim kuyruğundan düşür (5 Beklemede) / çıkışta kapat (6 Teslim Edildi) /
// geri al (1 Yeni). ManuMaestro approve / close / reopen akışları çağırır (best-effort).
// (İç s2s endpoint POST; Wisersell'e giden gerçek PUT webClient içinde.)
router.post('/orderitem-status', validateBody(orderItemStatusSchema), async (req: Request, res: Response) => {
  const { itemIds, statusId } = req.body as { itemIds: number[]; statusId: 1 | 5 | 6 };
  try {
    await markOrderItemsStatus(itemIds, statusId);
    await auditLog('wisersell-routing-orderitem-status', 'success', itemIds.length);
    logger.info(`[WisersellRouting] orderitem-status OK: ${itemIds.length} kalem → ${statusId}`);
    res.json({ success: true, count: itemIds.length, statusId });
  } catch (err: unknown) {
    await auditLog('wisersell-routing-orderitem-status', 'failed', 0, errMessage(err));
    logger.error('[WisersellRouting] orderitem-status error:', errMessage(err));
    res.status(502).json({ success: false, error: errMessage(err) });
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
  } catch (err: unknown) {
    await auditLog('wisersell-routing-close', 'failed', 0, errMessage(err));
    logger.error('[WisersellRouting] close error:', errMessage(err));
    res.status(502).json({ success: false, error: errMessage(err) });
  }
});

const platformCloseSchema = z.object({
  orderId: z.number().int().positive(),
});

// POST /api/wisersell-routing/platform-close  { orderId }
// Platform kapama (GET /api/orders/{id}/close). external-close'dan SONRA çağrılır.
// 429 (rate-limit) üst katmana 502 olarak döner; ManuMaestro throttle + backoff uygular.
router.post('/platform-close', validateBody(platformCloseSchema), async (req: Request, res: Response) => {
  const { orderId } = req.body as { orderId: number };
  try {
    await platformCloseOrder(orderId);
    await auditLog('wisersell-routing-platform-close', 'success', 1);
    logger.info(`[WisersellRouting] platform-close OK: order ${orderId}`);
    res.json({ success: true, orderId });
  } catch (err: unknown) {
    await auditLog('wisersell-routing-platform-close', 'failed', 0, errMessage(err));
    logger.error('[WisersellRouting] platform-close error:', errMessage(err));
    res.status(502).json({ success: false, error: errMessage(err) });
  }
});

const cancelSchema = z.object({
  orderId: z.number().int().positive(),
});

// POST /api/wisersell-routing/cancel  { orderId }
// Siparişi Wisersell'de iptal eder (Amazon'da iptal edilmiş, Wisersell'e yansımamış).
router.post('/cancel', validateBody(cancelSchema), async (req: Request, res: Response) => {
  const { orderId } = req.body as { orderId: number };
  try {
    await cancelOrder(orderId);
    await auditLog('wisersell-routing-cancel', 'success', 1);
    logger.info(`[WisersellRouting] cancel OK: order ${orderId}`);
    res.json({ success: true, orderId });
  } catch (err: unknown) {
    await auditLog('wisersell-routing-cancel', 'failed', 0, errMessage(err));
    logger.error('[WisersellRouting] cancel error:', errMessage(err));
    res.status(502).json({ success: false, error: errMessage(err) });
  }
});

const wayfairMapSchema = z.object({
  partNumber: z.string().min(1),
  iwasku: z.string().min(1),
});

// POST /api/wisersell-routing/wayfair-map  { partNumber, iwasku }
// CG export'unda eşleşmeyen iwasku için operatörün girdiği mapping'i kalıcılaştırır.
// wayfair_sku_mapping upsert + wayfair_inventory.iwasku güncelle + pricelab aggregation refresh
// (DataBridge POST /wayfair/mappings ile aynı yan etkiler; o uç SSO-only olduğu için burada tekrar).
router.post('/wayfair-map', validateBody(wayfairMapSchema), async (req: Request, res: Response) => {
  const { partNumber, iwasku } = req.body as { partNumber: string; iwasku: string };
  try {
    await pool.query(
      `INSERT INTO wayfair_sku_mapping (part_number, iwasku) VALUES ($1, $2)
       ON CONFLICT (part_number) DO UPDATE SET iwasku = EXCLUDED.iwasku, updated_at = NOW()`,
      [partNumber, iwasku],
    );
    await pool.query('UPDATE wayfair_inventory SET iwasku = $1 WHERE part_number = $2', [iwasku, partNumber]);
    await refreshWayfairAggregation();
    await auditLog('wisersell-routing-wayfair-map', 'success', 1);
    logger.info(`[WisersellRouting] wayfair-map OK: ${partNumber} → ${iwasku}`);
    res.json({ success: true });
  } catch (err: unknown) {
    await auditLog('wisersell-routing-wayfair-map', 'failed', 0, errMessage(err));
    logger.error('[WisersellRouting] wayfair-map error:', errMessage(err));
    res.status(500).json({ success: false, error: errMessage(err) });
  }
});

export default router;

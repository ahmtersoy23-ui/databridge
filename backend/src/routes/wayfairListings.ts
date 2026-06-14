import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate';
import { adminOpsAuth } from '../middleware/adminOps';
import { getAccountByLabel } from '../services/wayfair/client';
import { fetchWayfairCatalog, fetchWayfairCatalogFromDb } from '../services/wayfair/catalog';
import { pushWayfairInventory } from '../services/wayfair/inventoryPush';
import { pool } from '../config/database';
import { errMessage } from '../utils/errors';
import { notify } from '../utils/notify';
import logger from '../config/logger';

/**
 * Wayfair dropship stok push + katalog — ManuMaestro (server-to-server, x-internal-api-key).
 *   GET  /wayfair-listings/catalog?account=mdn[&activeOnly=1]  → listeli part'lar (iwasku join)
 *   POST /wayfair-listings/push  { account?, dryRun?, feedKind?, alert?, items:[{sku,quantity}] }
 * Amazon/Walmart push ile aynı kalıp; sku = supplierPartNumber. Hesap label ile
 * (varsayılan 'mdn'); shukran sonra sadece ?account=shukran ile eklenir.
 */

const router = Router();
router.use(adminOpsAuth);

router.get('/catalog', async (req: Request, res: Response) => {
  const label = ((req.query.account as string) || 'mdn').trim();
  const activeOnly = req.query.activeOnly === '1' || req.query.activeOnly === 'true';
  // source=db (varsayilan): wayfair_sku_mapping ∩ dropship sipariş geçmişi
  // (loadSupplierParts/integrations API'si bu hesaplar için null döndüğünden).
  // source=api: scope açılınca canlı katalog denenir.
  const source = ((req.query.source as string) || 'db').trim();
  try {
    const account = await getAccountByLabel(label);
    const parts =
      source === 'api'
        ? await fetchWayfairCatalog(account, { activeOnly })
        : await fetchWayfairCatalogFromDb(account.id);
    res.json({
      success: true,
      account: label,
      source,
      summary: {
        total: parts.length,
        active: parts.filter((p) => p.isActive).length,
        matched: parts.filter((p) => p.iwasku).length,
        unmatched: parts.filter((p) => !p.iwasku).length,
      },
      parts,
    });
  } catch (err) {
    logger.error(`[wayfair-listings/catalog] ${label} ${errMessage(err)}`);
    res.status(500).json({ success: false, error: errMessage(err) });
  }
});

const pushSchema = z.object({
  account: z.string().default('mdn'),
  dryRun: z.boolean().optional(),
  feedKind: z.enum(['DIFFERENTIAL', 'TRUE_UP']).optional(),
  /** Verilirse + dryRun degilse Slack'e dusurulur. */
  alert: z.string().max(2000).optional(),
  items: z
    .array(z.object({ sku: z.string().min(1), quantity: z.number().int().min(0), supplierId: z.number().int().positive().optional() }))
    .min(1)
    .max(5000),
});

router.post('/push', validateBody(pushSchema), async (req: Request, res: Response) => {
  const { account: label, dryRun, feedKind, alert, items } = req.body as z.infer<typeof pushSchema>;
  try {
    const account = await getAccountByLabel(label);
    const results = await pushWayfairInventory(account, items, { dryRun: !!dryRun, feedKind });
    const summary = {
      total: results.length,
      pushed: results.filter((r) => r.status === 'pushed').length,
      skipped: 0,
      dryrun: results.filter((r) => r.status === 'dryrun').length,
      failed: results.filter((r) => r.status === 'failed').length,
    };
    await pool
      .query(
        `INSERT INTO sync_log (job_name, status, rows_processed, error_message, detail, finished_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          `wayfair-inv-push${dryRun ? '-dryrun' : ''}`,
          summary.failed > 0 ? 'failed' : 'success',
          summary.pushed,
          summary.failed ? `${summary.failed} sku basarisiz` : null,
          JSON.stringify({ account: label, feedKind: feedKind ?? 'DIFFERENTIAL', ...summary }).slice(0, 300),
        ],
      )
      .catch(() => {
        /* audit log akisi bozmasin */
      });
    logger.info(`[wayfair-listings/push] ${label} dryRun=${!!dryRun} ${JSON.stringify(summary)}`);
    if (alert && !dryRun) {
      await notify(`🟠 Wayfair stok push — ${alert}`).catch(() => {});
    }
    res.json({ success: true, dryRun: !!dryRun, summary, results });
  } catch (err) {
    logger.error(`[wayfair-listings/push] ${errMessage(err)}`);
    res.status(500).json({ success: false, error: errMessage(err) });
  }
});

export default router;

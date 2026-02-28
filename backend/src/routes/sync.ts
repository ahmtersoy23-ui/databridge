import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/database';
import { runInventorySync, runSalesSync, getActiveMarketplaces, writeSalesData } from '../services/sync/scheduler';
import { syncInventoryForMarketplace } from '../services/sync/inventorySync';
import { syncSalesForMarketplace } from '../services/sync/salesSync';
import { backfillSales } from '../services/sync/salesSync';
import { validateBody } from '../middleware/validate';
import { authMiddleware } from '../middleware/auth';
import logger from '../config/logger';

const router = Router();

const triggerSchema = z.object({
  type: z.enum(['inventory', 'sales', 'backfill', 'refresh_sales_data']),
  marketplace: z.string().optional(),
  months: z.number().min(1).max(24).optional(),
});

// POST /api/v1/sync/trigger - Manual sync trigger (auth required)
router.post('/trigger', authMiddleware, validateBody(triggerSchema), async (req: Request, res: Response) => {
  const { type, marketplace, months } = req.body;

  try {
    if (type === 'inventory') {
      if (marketplace) {
        const mp = await getMarketplaceByCode(marketplace);
        if (!mp) {
          res.status(404).json({ success: false, error: `Marketplace not found: ${marketplace}` });
          return;
        }
        const count = await syncInventoryForMarketplace(mp);
        res.json({ success: true, message: `Inventory synced for ${marketplace}`, records: count });
      } else {
        // Async - run in background
        runInventorySync().catch(err => logger.error('[Sync] Manual inventory sync error:', err));
        res.json({ success: true, message: 'Inventory sync started for all marketplaces' });
      }
    } else if (type === 'sales') {
      if (marketplace) {
        const mp = await getMarketplaceByCode(marketplace);
        if (!mp) {
          res.status(404).json({ success: false, error: `Marketplace not found: ${marketplace}` });
          return;
        }
        const count = await syncSalesForMarketplace(mp);
        res.json({ success: true, message: `Sales synced for ${marketplace}`, records: count });
      } else {
        runSalesSync().catch(err => logger.error('[Sync] Manual sales sync error:', err));
        res.json({ success: true, message: 'Sales sync started for all marketplaces' });
      }
    } else if (type === 'refresh_sales_data') {
      await writeSalesData();
      res.json({ success: true, message: 'Sales data refreshed to pricelab_db.sales_data' });
    } else if (type === 'backfill') {
      if (!marketplace) {
        res.status(400).json({ success: false, error: 'Marketplace required for backfill' });
        return;
      }
      const mp = await getMarketplaceByCode(marketplace);
      if (!mp) {
        res.status(404).json({ success: false, error: `Marketplace not found: ${marketplace}` });
        return;
      }
      // Run backfill in background
      backfillSales(mp, months || 13).catch(err => logger.error('[Sync] Backfill error:', err));
      res.json({ success: true, message: `Sales backfill started for ${marketplace} (${months || 13} months)` });
    }
  } catch (err: any) {
    logger.error('[Sync] Trigger error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/sync/jobs - Recent sync jobs
router.get('/jobs', authMiddleware, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT id, job_type, marketplace, status, started_at, completed_at,
             records_processed, error_message, created_at
      FROM sync_jobs
      ORDER BY created_at DESC
      LIMIT 50
    `);
    res.json({ success: true, data: result.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

async function getMarketplaceByCode(code: string) {
  const result = await pool.query(
    'SELECT * FROM marketplace_config WHERE country_code = $1',
    [code.toUpperCase()]
  );
  return result.rows[0] || null;
}

export default router;

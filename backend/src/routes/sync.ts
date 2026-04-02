import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/database';
import { runInventorySync, runSalesSync, runTransactionSync, runNJWarehouseSync, runWisersellSync, runWayfairSync, runReviewSync, runInventoryAgingSync, getActiveMarketplaces, writeSalesData, writeInventoryData } from '../services/sync/scheduler';
import { syncInventoryForMarketplace } from '../services/sync/inventorySync';
import { syncSalesForMarketplace, backfillSales } from '../services/sync/salesSync';
import { syncTransactionsForMarketplace, backfillTransactions } from '../services/sync/transactionSync';
import { validateBody } from '../middleware/validate';
import logger from '../config/logger';

const router = Router();

const triggerSchema = z.object({
  type: z.enum(['inventory', 'sales', 'backfill', 'transactions', 'transaction_backfill', 'refresh_sales_data', 'refresh_inventory_data', 'nj_warehouse', 'wisersell', 'wayfair', 'reviews', 'inventory_aging']),
  marketplace: z.string().optional(),
  months: z.number().min(1).max(24).optional(),
});

// POST /api/v1/sync/trigger - Manual sync trigger (no auth — internal tool)
router.post('/trigger', validateBody(triggerSchema), async (req: Request, res: Response) => {
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
    } else if (type === 'refresh_inventory_data') {
      await writeInventoryData();
      res.json({ success: true, message: 'Inventory data refreshed to pricelab_db.fba_inventory' });
    } else if (type === 'nj_warehouse') {
      runNJWarehouseSync().catch(err => logger.error('[Sync] Manual NJ warehouse sync error:', err));
      res.json({ success: true, message: 'NJ warehouse sync started' });
    } else if (type === 'wisersell') {
      runWisersellSync().catch(err => logger.error('[Sync] Manual Wisersell sync error:', err));
      res.json({ success: true, message: 'Wisersell catalog sync started' });
    } else if (type === 'wayfair') {
      const accountLabel = req.body.account as string | undefined;
      if (accountLabel) {
        // Sync specific account
        const { getAccountByLabel } = require('../services/wayfair/client');
        const { syncWayfairAccount } = require('../services/sync/wayfairSync');
        const account = await getAccountByLabel(accountLabel);
        syncWayfairAccount(account).catch((err: any) => logger.error(`[Sync] Wayfair ${accountLabel} error:`, err));
        res.json({ success: true, message: `Wayfair sync started for '${accountLabel}'` });
      } else {
        runWayfairSync().catch(err => logger.error('[Sync] Manual Wayfair sync error:', err));
        res.json({ success: true, message: 'Wayfair sync started for all accounts' });
      }
    } else if (type === 'reviews') {
      runReviewSync().catch(err => logger.error('[Sync] Manual review sync error:', err));
      res.json({ success: true, message: 'Review tracking sync started' });
    } else if (type === 'inventory_aging') {
      runInventoryAgingSync().catch(err => logger.error('[Sync] Manual inventory aging sync error:', err));
      res.json({ success: true, message: 'Inventory aging sync started for all marketplaces' });
    } else if (type === 'transactions') {
      if (marketplace) {
        const mp = await getMarketplaceByCode(marketplace);
        if (!mp) {
          res.status(404).json({ success: false, error: `Marketplace not found: ${marketplace}` });
          return;
        }
        const count = await syncTransactionsForMarketplace(mp);
        res.json({ success: true, message: `Transactions synced for ${marketplace}`, records: count });
      } else {
        runTransactionSync().catch(err => logger.error('[Sync] Manual transaction sync error:', err));
        res.json({ success: true, message: 'Transaction sync started for all marketplaces' });
      }
    } else if (type === 'transaction_backfill') {
      if (!marketplace) {
        res.status(400).json({ success: false, error: 'Marketplace required for transaction backfill' });
        return;
      }
      const mp = await getMarketplaceByCode(marketplace);
      if (!mp) {
        res.status(404).json({ success: false, error: `Marketplace not found: ${marketplace}` });
        return;
      }
      backfillTransactions(mp, months || 18).catch(err => logger.error('[Sync] Transaction backfill error:', err));
      res.json({ success: true, message: `Transaction backfill started for ${marketplace} (${months || 18} months)` });
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

      // Check for sibling marketplaces sharing the same credential
      // SP-API returns all orders for the entire region in one call
      const siblings = await getSiblingMarketplaces(mp);
      const siblingNote = siblings.length > 0
        ? ` (covers ${[mp.country_code, ...siblings.map(s => s.country_code)].join(',')} via sales-channel mapping)`
        : '';

      backfillSales(mp, months || 13).catch(err => logger.error('[Sync] Backfill error:', err));
      res.json({ success: true, message: `Sales backfill started for ${marketplace}${siblingNote} (${months || 13} months)` });
    }
  } catch (err: any) {
    logger.error('[Sync] Trigger error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/sync/jobs - Recent sync jobs (no auth — internal tool)
router.get('/jobs', async (_req: Request, res: Response) => {
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

async function getSiblingMarketplaces(mp: any) {
  if (!mp.credential_id) return [];
  const result = await pool.query(
    'SELECT country_code FROM marketplace_config WHERE credential_id = $1 AND marketplace_id <> $2 AND is_active = true',
    [mp.credential_id, mp.marketplace_id]
  );
  return result.rows;
}

export default router;

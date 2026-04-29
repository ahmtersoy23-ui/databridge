import { Router, Request, Response } from 'express';
import { pool } from '../config/database';
import { adminOpsAuth } from '../middleware/adminOps';

const router = Router();

// GET /api/v1/status — Public health probe (UptimeRobot icin).
// Body sade: db baglantisi + uptime + timestamp. Detayli sync/marketplace/credential
// bilgisi /status/detailed'a tasindi (adminOpsAuth ile korumali). Onceden bu endpoint
// sync error mesajlari, SKU listeleri, credential count ve unmatched orders sizdiriyordu.
router.get('/', async (_req: Request, res: Response) => {
  let dbStatus: 'connected' | 'disconnected' = 'disconnected';
  try {
    await pool.query('SELECT 1');
    dbStatus = 'connected';
  } catch {
    dbStatus = 'disconnected';
  }

  res.status(dbStatus === 'connected' ? 200 : 503).json({
    ok: dbStatus === 'connected',
    db: dbStatus,
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// GET /api/v1/status/sync/health — Public sync sağlığı (UptimeRobot icin).
// Body sade: sadece overall healthy boolean + sayım. HTTP 200/503 ile UptimeRobot
// fail tetikler. Job-spesifik error message ve job_name detaylari /detailed'da.
router.get('/sync/health', async (_req: Request, res: Response) => {
  try {
    const jobs = await pool.query<{
      job_name: string;
      status: string;
      started_at: string;
    }>(`
      SELECT DISTINCT ON (job_name) job_name, status, started_at
      FROM sync_log
      ORDER BY job_name, started_at DESC
    `);

    const expected = ['inventory', 'sales', 'transactions', 'nj-warehouse', 'wisersell', 'wayfair', 'ads', 'aging'];
    const lastRuns = new Map(jobs.rows.map(r => [r.job_name, r]));
    const now = Date.now();

    let healthyCount = 0;
    for (const name of expected) {
      const last = lastRuns.get(name);
      if (!last || last.status !== 'success') continue;
      const ageHours = (now - new Date(last.started_at).getTime()) / 3_600_000;
      const maxAge = name === 'inventory' || name === 'nj-warehouse' ? 10 : 26;
      if (ageHours < maxAge) healthyCount++;
    }

    const allHealthy = healthyCount === expected.length;
    res.status(allHealthy ? 200 : 503).json({
      healthy: allHealthy,
      healthyJobs: healthyCount,
      totalJobs: expected.length,
    });
  } catch {
    res.status(503).json({ healthy: false });
  }
});

// GET /api/v1/status/detailed — Tum sync, marketplace, credential, SKU eslesme detayi.
// Dual-mode auth (adminOpsAuth): cron icin x-internal-api-key header, UI icin SSO admin.
// Onceden public idi (Fix 5: 2026-04-30 — sync error mesajlari, SKU listeleri sizdiriyordu).
router.get('/detailed', adminOpsAuth, async (_req: Request, res: Response) => {
  try {
    const lastSyncs = await pool.query(`
      SELECT DISTINCT ON (job_type, marketplace)
        job_type, marketplace, status, started_at, completed_at,
        records_processed, error_message
      FROM sync_jobs
      ORDER BY job_type, marketplace, created_at DESC
    `);

    const marketplaces = await pool.query(
      'SELECT country_code, channel, warehouse, region, is_active FROM marketplace_config ORDER BY country_code'
    );

    const credentials = await pool.query(`
      SELECT region, COUNT(*) as count, bool_or(is_active) as has_active
      FROM sp_api_credentials
      GROUP BY region
    `);

    const counts = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM raw_orders WHERE sku NOT LIKE 'amzn.gr.%') as total_orders,
        (SELECT COUNT(*) FROM fba_inventory WHERE sku NOT LIKE 'amzn.gr.%') as total_inventory,
        (SELECT COUNT(DISTINCT channel) FROM raw_orders) as channels_with_data,
        (SELECT COUNT(DISTINCT warehouse) FROM fba_inventory) as warehouses_with_data
    `);

    const skuMatch = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN iwasku IS NOT NULL THEN 1 END) as matched,
        COUNT(CASE WHEN iwasku IS NULL THEN 1 END) as unmatched
      FROM raw_orders
      WHERE sku NOT LIKE 'amzn.gr.%'
    `);

    const unmatchedSkus = await pool.query(`
      SELECT sku, asin, channel, COUNT(*) as order_count, SUM(quantity) as total_qty
      FROM raw_orders
      WHERE iwasku IS NULL AND sku NOT LIKE 'amzn.gr.%'
      GROUP BY sku, asin, channel
      ORDER BY order_count DESC
      LIMIT 20
    `);

    const invMatch = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN iwasku IS NOT NULL THEN 1 END) as matched,
        COUNT(CASE WHEN iwasku IS NULL THEN 1 END) as unmatched
      FROM fba_inventory
      WHERE sku NOT LIKE 'amzn.gr.%'
    `);

    const unmatchedInv = await pool.query(`
      SELECT sku, asin, warehouse, fulfillable_quantity
      FROM fba_inventory
      WHERE iwasku IS NULL AND sku NOT LIKE 'amzn.gr.%'
      ORDER BY fulfillable_quantity DESC
      LIMIT 20
    `);

    const wfInvMatch = await pool.query(`
      SELECT
        COUNT(DISTINCT part_number) as total,
        COUNT(DISTINCT CASE WHEN iwasku IS NOT NULL THEN part_number END) as matched,
        COUNT(DISTINCT CASE WHEN iwasku IS NULL THEN part_number END) as unmatched
      FROM wayfair_inventory
    `);

    const wfUnmatchedInv = await pool.query(`
      SELECT part_number, SUM(quantity) as total_qty
      FROM wayfair_inventory
      WHERE iwasku IS NULL
      GROUP BY part_number
      ORDER BY total_qty DESC
      LIMIT 20
    `);

    res.json({
      success: true,
      data: {
        lastSyncs: lastSyncs.rows,
        marketplaces: marketplaces.rows,
        credentials: credentials.rows,
        dataCounts: counts.rows[0],
        skuQuality: {
          orders: skuMatch.rows[0],
          unmatchedOrders: unmatchedSkus.rows,
          inventory: invMatch.rows[0],
          unmatchedInventory: unmatchedInv.rows,
        },
        wayfairSkuQuality: {
          inventory: wfInvMatch.rows[0],
          unmatchedInventory: wfUnmatchedInv.rows,
        },
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

export default router;

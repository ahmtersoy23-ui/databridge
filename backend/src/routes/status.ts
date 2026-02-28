import { Router, Request, Response } from 'express';
import { pool } from '../config/database';

const router = Router();

// GET /api/v1/status - Sync status overview (public)
router.get('/', async (_req: Request, res: Response) => {
  try {
    // Last sync per job type + marketplace
    const lastSyncs = await pool.query(`
      SELECT DISTINCT ON (job_type, marketplace)
        job_type, marketplace, status, started_at, completed_at,
        records_processed, error_message
      FROM sync_jobs
      ORDER BY job_type, marketplace, created_at DESC
    `);

    // Active marketplace count
    const marketplaces = await pool.query(
      'SELECT country_code, channel, warehouse, region, is_active FROM marketplace_config ORDER BY country_code'
    );

    // Credentials status per region
    const credentials = await pool.query(`
      SELECT region, COUNT(*) as count, bool_or(is_active) as has_active
      FROM sp_api_credentials
      GROUP BY region
    `);

    // Data counts
    const counts = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM raw_orders) as total_orders,
        (SELECT COUNT(*) FROM fba_inventory) as total_inventory,
        (SELECT COUNT(DISTINCT channel) FROM raw_orders) as channels_with_data,
        (SELECT COUNT(DISTINCT warehouse) FROM fba_inventory) as warehouses_with_data
    `);

    res.json({
      success: true,
      data: {
        lastSyncs: lastSyncs.rows,
        marketplaces: marketplaces.rows,
        credentials: credentials.rows,
        dataCounts: counts.rows[0],
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

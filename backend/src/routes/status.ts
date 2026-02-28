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

    // Data counts (exclude amzn.gr return SKUs)
    const counts = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM raw_orders WHERE sku NOT LIKE 'amzn.gr.%') as total_orders,
        (SELECT COUNT(*) FROM fba_inventory WHERE sku NOT LIKE 'amzn.gr.%') as total_inventory,
        (SELECT COUNT(DISTINCT channel) FROM raw_orders) as channels_with_data,
        (SELECT COUNT(DISTINCT warehouse) FROM fba_inventory) as warehouses_with_data
    `);

    // SKU match quality (exclude amzn.gr return SKUs)
    const skuMatch = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN iwasku IS NOT NULL THEN 1 END) as matched,
        COUNT(CASE WHEN iwasku IS NULL THEN 1 END) as unmatched
      FROM raw_orders
      WHERE sku NOT LIKE 'amzn.gr.%'
    `);

    const unmatchedSkus = await pool.query(`
      SELECT sku, asin, channel, COUNT(*) as order_count,
             SUM(quantity) as total_qty
      FROM raw_orders
      WHERE iwasku IS NULL AND sku NOT LIKE 'amzn.gr.%'
      GROUP BY sku, asin, channel
      ORDER BY order_count DESC
      LIMIT 20
    `);

    // Inventory match quality (exclude amzn.gr return SKUs)
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
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import { pool } from '../config/database';
import logger from '../config/logger';

const router = Router();

const VALID_WAREHOUSES = ['US', 'UK', 'EU', 'CA', 'AU', 'AE', 'SA'];

// GET /api/v1/inventory-aging/:warehouse — Raw aging data grouped by iwasku
router.get('/:warehouse', async (req: Request, res: Response) => {
  const warehouse = req.params.warehouse.toUpperCase();

  if (warehouse === 'SUMMARY') {
    // handled by the /summary/:warehouse route below
    res.status(400).json({ error: 'Use /summary/:warehouse for aggregate data' });
    return;
  }

  if (!VALID_WAREHOUSES.includes(warehouse)) {
    res.status(400).json({ error: `Invalid warehouse: ${warehouse}. Valid: ${VALID_WAREHOUSES.join(', ')}` });
    return;
  }

  try {
    const result = await pool.query(`
      SELECT
        COALESCE(iwasku, sku) as iwasku,
        (array_agg(asin ORDER BY available_quantity DESC))[1] as asin,
        (array_agg(product_name ORDER BY available_quantity DESC))[1] as product_name,
        SUM(available_quantity)::int as available_quantity,
        SUM(inv_age_0_to_90_days)::int as inv_age_0_to_90_days,
        SUM(inv_age_91_to_180_days)::int as inv_age_91_to_180_days,
        SUM(inv_age_181_to_270_days)::int as inv_age_181_to_270_days,
        SUM(inv_age_271_to_365_days)::int as inv_age_271_to_365_days,
        SUM(inv_age_365_plus_days)::int as inv_age_365_plus_days,
        SUM(estimated_ltsf_next_charge)::decimal as estimated_ltsf_next_charge,
        SUM(estimated_ltsf_6_mo)::decimal as estimated_ltsf_6_mo,
        SUM(estimated_ltsf_12_mo)::decimal as estimated_ltsf_12_mo,
        SUM(units_shipped_last_30_days)::int as units_shipped_last_30_days,
        SUM(units_shipped_last_90_days)::int as units_shipped_last_90_days,
        MAX(sell_through) as sell_through,
        (array_agg(recommended_action ORDER BY available_quantity DESC))[1] as recommended_action,
        SUM(estimated_cost_savings)::decimal as estimated_cost_savings,
        MAX(snapshot_date) as snapshot_date
      FROM fba_inventory_aging
      WHERE warehouse = $1 AND sku NOT LIKE 'amzn.gr.%'
      GROUP BY COALESCE(iwasku, sku)
      ORDER BY COALESCE(iwasku, sku)
    `, [warehouse]);

    logger.info(`[InventoryAging] Serving ${warehouse}: ${result.rows.length} items`);
    res.json(result.rows);
  } catch (err: any) {
    logger.error(`[InventoryAging] Error for warehouse ${warehouse}:`, err.message);
    res.status(500).json({ error: 'Failed to fetch inventory aging data' });
  }
});

// GET /api/v1/inventory-aging/summary/:warehouse — Aggregate summary for analysis page
router.get('/summary/:warehouse', async (req: Request, res: Response) => {
  const warehouse = req.params.warehouse.toUpperCase();

  if (!VALID_WAREHOUSES.includes(warehouse)) {
    res.status(400).json({ error: `Invalid warehouse: ${warehouse}` });
    return;
  }

  try {
    const result = await pool.query(`
      SELECT
        SUM(inv_age_0_to_90_days)::int as age_0_90,
        SUM(inv_age_91_to_180_days)::int as age_91_180,
        SUM(inv_age_181_to_270_days)::int as age_181_270,
        SUM(inv_age_271_to_365_days)::int as age_271_365,
        SUM(inv_age_365_plus_days)::int as age_365_plus,
        SUM(estimated_ltsf_next_charge)::decimal as total_ltsf_next,
        SUM(estimated_ltsf_6_mo)::decimal as total_ltsf_6_mo,
        SUM(estimated_ltsf_12_mo)::decimal as total_ltsf_12_mo,
        COUNT(DISTINCT COALESCE(iwasku, sku)) as unique_skus,
        COUNT(DISTINCT COALESCE(iwasku, sku)) FILTER (
          WHERE inv_age_271_to_365_days > 0 OR inv_age_365_plus_days > 0
        ) as skus_270_plus
      FROM fba_inventory_aging
      WHERE warehouse = $1 AND sku NOT LIKE 'amzn.gr.%'
    `, [warehouse]);

    res.json(result.rows[0] || null);
  } catch (err: any) {
    logger.error(`[InventoryAging] Summary error for ${warehouse}:`, err.message);
    res.status(500).json({ error: 'Failed to fetch aging summary' });
  }
});

export default router;

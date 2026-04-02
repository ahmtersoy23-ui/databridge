import { Router, Request, Response } from 'express';
import multer from 'multer';
import { pool } from '../config/database';
import { mapBulkSkusToIwasku } from '../services/skuMapper';
import logger from '../config/logger';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const VALID_WAREHOUSES = ['US', 'UK', 'EU', 'CA', 'AU', 'AE', 'SA'];

// Seller Central marketplace field → warehouse mapping
const MARKETPLACE_TO_WAREHOUSE: Record<string, string> = {
  US: 'US', CA: 'CA', UK: 'UK', DE: 'EU', FR: 'EU', IT: 'EU', ES: 'EU',
  AU: 'AU', AE: 'AE', SA: 'SA',
};

// POST /api/v1/inventory-aging/upload — Upload Seller Central TSV/CSV
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  try {
    const content = req.file.buffer.toString('utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    if (lines.length < 2) {
      res.status(400).json({ error: 'File is empty or has no data rows' });
      return;
    }

    const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());
    const rows: any[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split('\t');
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => { row[h] = (values[idx] || '').trim(); });
      if (!row['sku']) continue;
      rows.push(row);
    }

    if (rows.length === 0) {
      res.status(400).json({ error: 'No valid data rows found' });
      return;
    }

    // Determine warehouse from marketplace field
    const marketplaceField = rows[0]['marketplace'] || '';
    const warehouse = MARKETPLACE_TO_WAREHOUSE[marketplaceField] || 'US';

    // Map SKUs to iwasku
    const skuMappings = await mapBulkSkusToIwasku(
      rows.map(r => ({ sku: r['sku'], countryCode: marketplaceField || 'US', asin: r['asin'] || '' }))
    );

    // Parse rows into DB items
    const items = rows.map(r => ({
      warehouse,
      marketplace_id: marketplaceField,
      snapshot_date: r['snapshot-date'] || null,
      sku: r['sku'],
      fnsku: r['fnsku'] || null,
      asin: r['asin'] || null,
      iwasku: skuMappings.get(r['sku']) || null,
      product_name: r['product-name'] || null,
      condition: r['condition'] || null,
      available_quantity: parseInt(r['available'] || '0') || 0,
      qty_with_removals_in_progress: parseInt(r['pending-removal-quantity'] || '0') || 0,
      inv_age_0_to_90_days: parseInt(r['inv-age-0-to-90-days'] || '0') || 0,
      inv_age_91_to_180_days: parseInt(r['inv-age-91-to-180-days'] || '0') || 0,
      inv_age_181_to_270_days: parseInt(r['inv-age-181-to-270-days'] || '0') || 0,
      inv_age_271_to_365_days: parseInt(r['inv-age-271-to-365-days'] || '0') || 0,
      inv_age_366_to_455_days: parseInt(r['inv-age-366-to-455-days'] || '0') || 0,
      inv_age_456_plus_days: parseInt(r['inv-age-456-plus-days'] || '0') || 0,
      currency: r['currency'] || null,
      estimated_storage_cost_next_month: parseFloat(r['estimated-storage-cost-next-month'] || '0') || 0,
      units_shipped_last_7_days: parseInt(r['units-shipped-t7'] || '0') || 0,
      units_shipped_last_30_days: parseInt(r['units-shipped-t30'] || '0') || 0,
      units_shipped_last_60_days: parseInt(r['units-shipped-t60'] || '0') || 0,
      units_shipped_last_90_days: parseInt(r['units-shipped-t90'] || '0') || 0,
      recommended_removal_quantity: parseInt(r['recommended-removal-quantity'] || '0') || 0,
      alert: r['alert'] || null,
      your_price: parseFloat(r['your-price'] || '0') || null,
      sales_price: parseFloat(r['sales-price'] || '0') || null,
      sell_through: parseFloat(r['sell-through'] || '0') || null,
      storage_type: r['storage-type'] || null,
      recommended_action: r['recommended-action'] || null,
      days_of_supply: parseInt(r['days-of-supply'] || '0') || null,
      estimated_excess_quantity: parseInt(r['estimated-excess-quantity'] || '0') || 0,
      weeks_of_cover_t30: parseFloat(r['weeks-of-cover-t30'] || '0') || null,
      weeks_of_cover_t90: parseFloat(r['weeks-of-cover-t90'] || '0') || null,
      no_sale_last_6_months: parseInt(r['no-sale-last-6-months'] || '0') || 0,
      inbound_quantity: parseInt(r['inbound-quantity'] || '0') || 0,
      sales_rank: parseInt(r['sales-rank'] || '0') || null,
      product_group: r['product-group'] || null,
    }));

    // DELETE + INSERT for warehouse
    await pool.query('DELETE FROM fba_inventory_aging WHERE warehouse = $1', [warehouse]);

    const BATCH_SIZE = 200;
    const COLS = 38;
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      const values: string[] = [];
      const params: any[] = [];

      batch.forEach((item, idx) => {
        const offset = idx * COLS;
        const placeholders = Array.from({ length: COLS }, (_, j) => `$${offset + j + 1}`);
        values.push(`(${placeholders.join(', ')})`);
        params.push(
          item.warehouse, item.marketplace_id, item.snapshot_date, item.sku, item.fnsku,
          item.asin, item.iwasku, item.product_name, item.condition,
          item.available_quantity, item.qty_with_removals_in_progress,
          item.inv_age_0_to_90_days, item.inv_age_91_to_180_days,
          item.inv_age_181_to_270_days, item.inv_age_271_to_365_days,
          item.inv_age_366_to_455_days, item.inv_age_456_plus_days,
          item.currency, item.estimated_storage_cost_next_month,
          item.units_shipped_last_7_days, item.units_shipped_last_30_days,
          item.units_shipped_last_60_days, item.units_shipped_last_90_days,
          item.recommended_removal_quantity, item.alert, item.your_price,
          item.sales_price, item.sell_through, item.storage_type,
          item.recommended_action, item.days_of_supply, item.estimated_excess_quantity,
          item.weeks_of_cover_t30, item.weeks_of_cover_t90,
          item.no_sale_last_6_months, item.inbound_quantity,
          item.sales_rank, item.product_group,
        );
      });

      await pool.query(`
        INSERT INTO fba_inventory_aging (
          warehouse, marketplace_id, snapshot_date, sku, fnsku, asin, iwasku,
          product_name, condition, available_quantity, qty_with_removals_in_progress,
          inv_age_0_to_90_days, inv_age_91_to_180_days, inv_age_181_to_270_days,
          inv_age_271_to_365_days, inv_age_366_to_455_days, inv_age_456_plus_days,
          currency, estimated_storage_cost_next_month,
          units_shipped_last_7_days, units_shipped_last_30_days,
          units_shipped_last_60_days, units_shipped_last_90_days,
          recommended_removal_quantity, alert, your_price, sales_price,
          sell_through, storage_type, recommended_action,
          days_of_supply, estimated_excess_quantity, weeks_of_cover_t30,
          weeks_of_cover_t90, no_sale_last_6_months, inbound_quantity,
          sales_rank, product_group
        ) VALUES ${values.join(', ')}
      `, params);
    }

    logger.info(`[InventoryAging] Uploaded ${items.length} items for warehouse ${warehouse}`);
    res.json({ success: true, warehouse, items: items.length });
  } catch (err: any) {
    logger.error('[InventoryAging] Upload error:', err.message);
    res.status(500).json({ error: 'Failed to process upload: ' + err.message });
  }
});

// GET /api/v1/inventory-aging/summary/:warehouse
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
        SUM(inv_age_366_to_455_days)::int as age_366_455,
        SUM(inv_age_456_plus_days)::int as age_456_plus,
        SUM(estimated_storage_cost_next_month)::decimal as total_storage_cost,
        COUNT(DISTINCT COALESCE(iwasku, sku)) as unique_skus,
        COUNT(DISTINCT COALESCE(iwasku, sku)) FILTER (
          WHERE inv_age_271_to_365_days > 0 OR inv_age_366_to_455_days > 0 OR inv_age_456_plus_days > 0
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

// GET /api/v1/inventory-aging/:warehouse
router.get('/:warehouse', async (req: Request, res: Response) => {
  const warehouse = req.params.warehouse.toUpperCase();

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
        SUM(inv_age_366_to_455_days)::int as inv_age_366_to_455_days,
        SUM(inv_age_456_plus_days)::int as inv_age_456_plus_days,
        SUM(estimated_storage_cost_next_month)::decimal as estimated_storage_cost,
        SUM(units_shipped_last_30_days)::int as units_shipped_last_30_days,
        MAX(sell_through) as sell_through,
        MAX(days_of_supply) as days_of_supply,
        (array_agg(recommended_action ORDER BY available_quantity DESC))[1] as recommended_action,
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

export default router;

import { getSpApiClient } from './client';
import { waitForReport } from './reportUtils';
import { pool } from '../../config/database';
import { mapBulkSkusToIwasku } from '../skuMapper';
import logger from '../../config/logger';
import type { MarketplaceConfig } from '../../types';

// Seller Central marketplace field → warehouse mapping
const MARKETPLACE_TO_WAREHOUSE: Record<string, string> = {
  US: 'US', CA: 'CA', UK: 'UK', DE: 'EU', FR: 'EU', IT: 'EU', ES: 'EU',
  AU: 'AU', AE: 'AE', SA: 'SA',
};

interface AgingItem {
  warehouse: string;
  marketplace_id: string;
  snapshot_date: string | null;
  sku: string;
  fnsku: string | null;
  asin: string | null;
  iwasku: string | null;
  product_name: string | null;
  condition: string | null;
  available_quantity: number;
  qty_with_removals_in_progress: number;
  inv_age_0_to_90_days: number;
  inv_age_91_to_180_days: number;
  inv_age_181_to_270_days: number;
  inv_age_271_to_365_days: number;
  inv_age_366_to_455_days: number;
  inv_age_456_plus_days: number;
  currency: string | null;
  estimated_storage_cost_next_month: number;
  units_shipped_last_7_days: number;
  units_shipped_last_30_days: number;
  units_shipped_last_60_days: number;
  units_shipped_last_90_days: number;
  recommended_removal_quantity: number;
  alert: string | null;
  your_price: number | null;
  sales_price: number | null;
  sell_through: number | null;
  storage_type: string | null;
  recommended_action: string | null;
  days_of_supply: number | null;
  estimated_excess_quantity: number;
  weeks_of_cover_t30: number | null;
  weeks_of_cover_t90: number | null;
  no_sale_last_6_months: number;
  inbound_quantity: number;
  sales_rank: number | null;
  product_group: string | null;
}

/**
 * Fetch GET_FBA_INVENTORY_PLANNING_DATA report for a credential/marketplace,
 * parse TSV rows, map SKUs, and upsert into fba_inventory_aging.
 *
 * Returns the number of rows written.
 */
export async function fetchAndWriteAgingReport(
  marketplace: MarketplaceConfig
): Promise<number> {
  const credentialId = marketplace.credential_id;
  if (!credentialId) {
    throw new Error(`No credential_id for ${marketplace.country_code}`);
  }

  const warehouse = MARKETPLACE_TO_WAREHOUSE[marketplace.country_code] || marketplace.warehouse;
  const client = await getSpApiClient(credentialId);

  // Step 1: Create report request
  logger.info(`[AgingReport] Requesting GET_FBA_INVENTORY_PLANNING_DATA for ${marketplace.country_code} (warehouse: ${warehouse})`);

  const reportResponse: any = await client.callAPI({
    operation: 'createReport',
    endpoint: 'reports',
    body: {
      reportType: 'GET_FBA_INVENTORY_PLANNING_DATA',
      marketplaceIds: [marketplace.marketplace_id],
    },
  });

  const reportId = reportResponse?.reportId;
  if (!reportId) {
    throw new Error(`Failed to create aging report for ${marketplace.country_code}`);
  }

  // Step 2: Poll for completion
  const document = await waitForReport(client, reportId);

  // Step 3: Download and parse (TSV format, json: true auto-parses)
  const reportData: any = await client.download(document, { json: true });

  if (!Array.isArray(reportData) || reportData.length === 0) {
    logger.warn(`[AgingReport] No data returned for ${marketplace.country_code}`);
    return 0;
  }

  logger.info(`[AgingReport] Downloaded ${reportData.length} rows for ${marketplace.country_code}`);

  // Step 4: Map SKUs to iwasku
  const countryCode = marketplace.country_code;
  const skuMappings = await mapBulkSkusToIwasku(
    reportData.map((r: any) => ({
      sku: r['sku'] || '',
      countryCode,
      asin: r['asin'] || '',
    }))
  );

  // Step 5: Parse rows into AgingItem objects
  const today = new Date().toISOString().split('T')[0];
  const items: AgingItem[] = [];

  for (const r of reportData) {
    const sku = r['sku'] || '';
    if (!sku) continue;

    items.push({
      warehouse,
      marketplace_id: countryCode,
      snapshot_date: r['snapshot-date'] || today,
      sku,
      fnsku: r['fnsku'] || null,
      asin: r['asin'] || null,
      iwasku: skuMappings.get(sku) || null,
      product_name: r['product-name'] || null,
      condition: r['condition'] || null,
      available_quantity: parseInt(r['available'] || r['avail-to-ship-qty'] || '0') || 0,
      qty_with_removals_in_progress: parseInt(r['pending-removal-quantity'] || r['qty-with-removals-in-progress'] || '0') || 0,
      inv_age_0_to_90_days: parseInt(r['inv-age-0-to-90-days'] || '0') || 0,
      inv_age_91_to_180_days: parseInt(r['inv-age-91-to-180-days'] || '0') || 0,
      inv_age_181_to_270_days: parseInt(r['inv-age-181-to-270-days'] || '0') || 0,
      inv_age_271_to_365_days: parseInt(r['inv-age-271-to-365-days'] || '0') || 0,
      inv_age_366_to_455_days: parseInt(r['inv-age-366-to-455-days'] || '0') || 0,
      inv_age_456_plus_days: parseInt(r['inv-age-456-plus-days'] || '0') || 0,
      currency: r['currency'] || null,
      estimated_storage_cost_next_month: parseFloat(r['estimated-storage-cost-next-month'] || '0') || 0,
      units_shipped_last_7_days: parseInt(r['units-shipped-t7'] || r['units-shipped-last-7-days'] || '0') || 0,
      units_shipped_last_30_days: parseInt(r['units-shipped-t30'] || r['units-shipped-last-30-days'] || '0') || 0,
      units_shipped_last_60_days: parseInt(r['units-shipped-t60'] || r['units-shipped-last-60-days'] || '0') || 0,
      units_shipped_last_90_days: parseInt(r['units-shipped-t90'] || r['units-shipped-last-90-days'] || '0') || 0,
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
    });
  }

  if (items.length === 0) {
    logger.warn(`[AgingReport] No valid items after parsing for ${marketplace.country_code}`);
    return 0;
  }

  // Step 6: DELETE old data for this warehouse + INSERT new data (same pattern as CSV upload)
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

  logger.info(`[AgingReport] Wrote ${items.length} aging items for warehouse ${warehouse}`);
  return items.length;
}

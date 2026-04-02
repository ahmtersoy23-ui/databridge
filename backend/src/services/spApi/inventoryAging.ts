import { getSpApiClient, getSpApiClientByRegion } from './client';
import { waitForReport } from './reportUtils';
import logger from '../../config/logger';
import type { MarketplaceConfig, FbaInventoryAgingItem } from '../../types';

export async function fetchFbaInventoryAging(
  marketplace: MarketplaceConfig
): Promise<FbaInventoryAgingItem[]> {
  const client = marketplace.credential_id
    ? await getSpApiClient(marketplace.credential_id)
    : await getSpApiClientByRegion(marketplace.region.toLowerCase());

  logger.info(`[SP-API] Requesting inventory aging report for ${marketplace.country_code}`);

  const reportResponse: any = await client.callAPI({
    operation: 'createReport',
    endpoint: 'reports',
    body: {
      reportType: 'GET_FBA_INVENTORY_AGED_DATA' as any,
      marketplaceIds: [marketplace.marketplace_id],
    },
  });

  const reportId = reportResponse?.reportId;
  if (!reportId) {
    throw new Error(`Failed to create aging report for ${marketplace.country_code}`);
  }

  const document = await waitForReport(client, reportId);
  const reportData: any = await client.download(document, { json: true });

  const items: FbaInventoryAgingItem[] = [];

  if (!Array.isArray(reportData)) {
    logger.warn(`[SP-API] Aging report returned non-array data for ${marketplace.country_code}`);
    return items;
  }

  for (const row of reportData) {
    const sku = row['sku'] || row['SKU'] || '';
    if (!sku) continue;

    items.push({
      warehouse: marketplace.warehouse,
      marketplace_id: marketplace.marketplace_id,
      snapshot_date: row['snapshot-date'] || null,
      sku,
      fnsku: row['fnsku'] || row['FNSKU'] || null,
      asin: row['asin'] || row['ASIN'] || null,
      iwasku: null,
      product_name: row['product-name'] || null,
      condition: row['condition'] || null,
      available_quantity: parseInt(row['available-quantity'] || row['qty-available'] || '0') || 0,
      qty_with_removals_in_progress: parseInt(row['qty-with-removals-in-progress'] || '0') || 0,
      inv_age_0_to_90_days: parseInt(row['inv-age-0-to-90-days'] || '0') || 0,
      inv_age_91_to_180_days: parseInt(row['inv-age-91-to-180-days'] || '0') || 0,
      inv_age_181_to_270_days: parseInt(row['inv-age-181-to-270-days'] || '0') || 0,
      inv_age_271_to_365_days: parseInt(row['inv-age-271-to-365-days'] || '0') || 0,
      inv_age_365_plus_days: parseInt(row['inv-age-365-plus-days'] || '0') || 0,
      currency: row['currency'] || null,
      estimated_ltsf_next_charge: parseFloat(row['estimated-ltsf-next-charge'] || '0') || 0,
      per_unit_volume: parseFloat(row['per-unit-volume'] || '0') || null,
      is_hazmat: row['is-hazmat'] === 'Yes' || row['is-hazmat'] === 'true',
      in_date: row['in-date'] || null,
      units_shipped_last_7_days: parseInt(row['units-shipped-last-7-days'] || '0') || 0,
      units_shipped_last_30_days: parseInt(row['units-shipped-last-30-days'] || '0') || 0,
      units_shipped_last_60_days: parseInt(row['units-shipped-last-60-days'] || '0') || 0,
      units_shipped_last_90_days: parseInt(row['units-shipped-last-90-days'] || '0') || 0,
      recommended_removal_quantity: parseInt(row['recommended-removal-quantity'] || '0') || 0,
      estimated_ltsf_6_mo: parseFloat(row['estimated-ltsf-6-mo'] || '0') || 0,
      estimated_ltsf_12_mo: parseFloat(row['estimated-ltsf-12-mo'] || '0') || 0,
      alert: row['alert'] || null,
      your_price: parseFloat(row['your-price'] || '0') || null,
      sales_price: parseFloat(row['sales-price'] || '0') || null,
      sell_through: parseFloat(row['sell-through'] || '0') || null,
      storage_type: row['storage-type'] || null,
      recommended_action: row['recommended-action'] || null,
      estimated_cost_savings: parseFloat(row['estimated-cost-savings-of-recommended-actions'] || '0') || 0,
      healthy_inventory_level: parseInt(row['healthy-inventory-level'] || '0') || null,
    });
  }

  logger.info(`[SP-API] Parsed ${items.length} aging items for ${marketplace.country_code}`);
  return items;
}

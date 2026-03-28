import { pool } from '../../config/database';
import logger from '../../config/logger';

const BATCH_SIZE = 500;

/**
 * Deduplicate rows by a key function — keeps last occurrence (latest values).
 */
function deduplicateRows(rows: any[], keyFn: (r: any) => string): any[] {
  const map = new Map<string, any>();
  for (const r of rows) {
    map.set(keyFn(r), r);
  }
  return Array.from(map.values());
}

/**
 * Batch upsert search term report rows.
 */
export async function writeSearchTermData(profileId: number, startDate: string, endDate: string, rows: any[]): Promise<number> {
  if (!rows.length) return 0;

  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values: any[] = [];
    const placeholders: string[] = [];

    for (let j = 0; j < batch.length; j++) {
      const r = batch[j];
      const offset = j * 18;
      placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16}, $${offset + 17}, $${offset + 18})`);
      values.push(
        profileId,
        r.startDate || startDate,
        r.portfolioId || null,
        r.campaignBudgetCurrencyCode || null,
        r.campaignName || null,
        r.campaignId || null,
        r.adGroupName || null,
        r.adGroupId || null,
        r.targeting || null,
        r.matchType || null,
        r.searchTerm || null,
        r.impressions || 0,
        r.clicks || 0,
        r.spend || 0,
        r.sales7d || 0,
        r.purchases7d || 0,
        r.unitsSoldClicks7d || 0,
        r.costPerClick || 0,
      );
    }

    await pool.query(
      `INSERT INTO ads_search_term_report (
        profile_id, report_date, portfolio_name, currency,
        campaign_name, campaign_id, ad_group_name, ad_group_id,
        targeting, match_type, customer_search_term,
        impressions, clicks, spend, sales_7d, orders_7d, units_7d, cpc
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT (profile_id, report_date, campaign_id, ad_group_id, customer_search_term, targeting, match_type)
      DO UPDATE SET
        impressions = EXCLUDED.impressions,
        clicks = EXCLUDED.clicks,
        spend = EXCLUDED.spend,
        sales_7d = EXCLUDED.sales_7d,
        orders_7d = EXCLUDED.orders_7d,
        units_7d = EXCLUDED.units_7d,
        cpc = EXCLUDED.cpc,
        synced_at = NOW()`,
      values
    );

    total += batch.length;
  }

  logger.info(`[AdsWriter] Search term: ${total} rows for profile ${profileId}`);
  return total;
}

/**
 * Batch upsert targeting report rows.
 */
export async function writeTargetingData(profileId: number, startDate: string, endDate: string, rows: any[]): Promise<number> {
  if (!rows.length) return 0;

  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values: any[] = [];
    const placeholders: string[] = [];

    for (let j = 0; j < batch.length; j++) {
      const r = batch[j];
      const offset = j * 16;
      placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16})`);
      values.push(
        profileId,
        r.startDate || startDate,
        r.portfolioId || null,
        r.campaignBudgetCurrencyCode || null,
        r.campaignName || null,
        r.campaignId || null,
        r.adGroupName || null,
        r.adGroupId || null,
        r.targeting || null,
        r.matchType || null,
        r.impressions || 0,
        r.clicks || 0,
        r.cost || r.spend || 0,
        r.sales7d || 0,
        r.purchases7d || 0,
        r.unitsSoldClicks7d || 0,
      );
    }

    await pool.query(
      `INSERT INTO ads_targeting_report (
        profile_id, report_date, portfolio_name, currency,
        campaign_name, campaign_id, ad_group_name, ad_group_id,
        targeting, match_type,
        impressions, clicks, spend, sales_7d, orders_7d, units_7d
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT (profile_id, report_date, campaign_id, ad_group_id, targeting, match_type)
      DO UPDATE SET
        impressions = EXCLUDED.impressions,
        clicks = EXCLUDED.clicks,
        spend = EXCLUDED.spend,
        sales_7d = EXCLUDED.sales_7d,
        orders_7d = EXCLUDED.orders_7d,
        units_7d = EXCLUDED.units_7d,
        synced_at = NOW()`,
      values
    );

    total += batch.length;
  }

  logger.info(`[AdsWriter] Targeting: ${total} rows for profile ${profileId}`);
  return total;
}

/**
 * Batch upsert advertised product report rows.
 */
export async function writeAdvertisedProductData(profileId: number, startDate: string, endDate: string, rows: any[]): Promise<number> {
  if (!rows.length) return 0;

  // Deduplicate by unique key (profile_id + report_date + campaign_id + ad_group_id)
  rows = deduplicateRows(rows, r => `${r.startDate || startDate}|${r.campaignId}|${r.adGroupId}`);

  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values: any[] = [];
    const placeholders: string[] = [];

    for (let j = 0; j < batch.length; j++) {
      const r = batch[j];
      const offset = j * 15;
      placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15})`);
      values.push(
        profileId,
        r.startDate || startDate,
        r.portfolioId || null,
        r.campaignBudgetCurrencyCode || null,
        r.campaignName || null,
        r.campaignId || null,
        r.adGroupName || null,
        r.adGroupId || null,
        r.impressions || 0,
        r.clicks || 0,
        r.spend || 0,
        r.sales7d || 0,
        r.purchases7d || 0,
        r.unitsSoldClicks7d || 0,
        r.costPerClick || 0,
      );
    }

    await pool.query(
      `INSERT INTO ads_advertised_product_report (
        profile_id, report_date, portfolio_name, currency,
        campaign_name, campaign_id, ad_group_name, ad_group_id,
        impressions, clicks, spend, sales_7d, orders_7d, units_7d, cpc
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT (profile_id, report_date, campaign_id, ad_group_id)
      DO UPDATE SET
        impressions = EXCLUDED.impressions,
        clicks = EXCLUDED.clicks,
        spend = EXCLUDED.spend,
        sales_7d = EXCLUDED.sales_7d,
        orders_7d = EXCLUDED.orders_7d,
        units_7d = EXCLUDED.units_7d,
        cpc = EXCLUDED.cpc,
        synced_at = NOW()`,
      values
    );

    total += batch.length;
  }

  logger.info(`[AdsWriter] Advertised product: ${total} rows for profile ${profileId}`);
  return total;
}

/**
 * Batch upsert purchased product report rows.
 */
export async function writePurchasedProductData(profileId: number, startDate: string, endDate: string, rows: any[]): Promise<number> {
  if (!rows.length) return 0;

  // Deduplicate by unique key (profile_id + report_date + campaign_id + ad_group_id + targeting)
  rows = deduplicateRows(rows, r => `${r.startDate || startDate}|${r.campaignId}|${r.adGroupId}|${r.targeting}`);

  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values: any[] = [];
    const placeholders: string[] = [];

    for (let j = 0; j < batch.length; j++) {
      const r = batch[j];
      const offset = j * 12;
      placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12})`);
      values.push(
        profileId,
        r.startDate || startDate,
        r.portfolioId || null,
        r.campaignBudgetCurrencyCode || null,
        r.campaignName || null,
        r.campaignId || null,
        r.adGroupName || null,
        r.adGroupId || null,
        r.targeting || null,
        r.matchType || null,
        r.unitsSoldOtherSku7d || 0,
        r.salesOtherSku7d || 0,
      );
    }

    await pool.query(
      `INSERT INTO ads_purchased_product_report (
        profile_id, report_date, portfolio_name, currency,
        campaign_name, campaign_id, ad_group_name, ad_group_id,
        targeting, match_type,
        other_sku_units_7d, other_sku_sales_7d
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT (profile_id, report_date, campaign_id, ad_group_id, targeting)
      DO UPDATE SET
        other_sku_units_7d = EXCLUDED.other_sku_units_7d,
        other_sku_sales_7d = EXCLUDED.other_sku_sales_7d,
        synced_at = NOW()`,
      values
    );

    total += batch.length;
  }

  logger.info(`[AdsWriter] Purchased product: ${total} rows for profile ${profileId}`);
  return total;
}

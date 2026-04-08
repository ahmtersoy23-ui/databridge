import { pool } from '../../config/database';
import logger from '../../config/logger';

const BATCH_SIZE = 500;

/**
 * Batch upsert SP Placement report rows.
 */
export async function writePlacementData(profileId: number, startDate: string, endDate: string, rows: any[]): Promise<number> {
  if (!rows.length) return 0;

  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values: any[] = [];
    const placeholders: string[] = [];

    for (let j = 0; j < batch.length; j++) {
      const r = batch[j];
      const offset = j * 11;
      placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11})`);
      values.push(
        profileId,
        r.date || startDate,
        r.campaignId || null,
        r.campaignName || null,
        r.placementClassification || null,
        r.impressions || 0,
        r.clicks || 0,
        r.cost || r.spend || 0,
        r.sales7d || 0,
        r.purchases7d || 0,
        r.unitsSoldClicks7d || 0,
      );
    }

    await pool.query(
      `INSERT INTO ads_placement_report (
        profile_id, report_date, campaign_id, campaign_name, placement,
        impressions, clicks, spend, sales_7d, orders_7d, units_7d
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT (profile_id, report_date, campaign_id, placement)
      DO UPDATE SET
        campaign_name = EXCLUDED.campaign_name,
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

  logger.info(`[AdsWriter] Placement: ${total} rows for profile ${profileId}`);
  return total;
}

/**
 * Batch upsert SP Campaign report rows.
 */
export async function writeCampaignReportData(profileId: number, startDate: string, endDate: string, rows: any[]): Promise<number> {
  if (!rows.length) return 0;

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
        r.date || startDate,
        r.campaignId || null,
        r.campaignName || null,
        r.campaignStatus || null,
        r.campaignBudgetAmount || null,
        r.impressions || 0,
        r.clicks || 0,
        r.cost || r.spend || 0,
        r.sales7d || 0,
        r.purchases7d || 0,
        r.unitsSoldClicks7d || 0,
      );
    }

    await pool.query(
      `INSERT INTO ads_campaign_report (
        profile_id, report_date, campaign_id, campaign_name, campaign_status, budget,
        impressions, clicks, spend, sales_7d, orders_7d, units_7d
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT (profile_id, report_date, campaign_id)
      DO UPDATE SET
        campaign_name = EXCLUDED.campaign_name,
        campaign_status = EXCLUDED.campaign_status,
        budget = EXCLUDED.budget,
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

  logger.info(`[AdsWriter] Campaign report: ${total} rows for profile ${profileId}`);
  return total;
}

/**
 * Batch upsert SB Campaign report rows (14d attribution).
 */
export async function writeSbCampaignData(profileId: number, startDate: string, endDate: string, rows: any[]): Promise<number> {
  if (!rows.length) return 0;

  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values: any[] = [];
    const placeholders: string[] = [];

    for (let j = 0; j < batch.length; j++) {
      const r = batch[j];
      const offset = j * 13;
      placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13})`);
      values.push(
        profileId,
        r.date || startDate,
        r.campaignId || null,
        r.campaignName || null,
        r.impressions || 0,
        r.clicks || 0,
        r.cost || r.spend || 0,
        r.sales || r.sales14d || 0,
        r.purchases || r.purchases14d || 0,
        r.unitsSold || r.unitsSoldClicks14d || 0,
        r.newToBrandPurchases || r.newToBrandPurchases14d || 0,
        r.newToBrandSales || r.newToBrandSales14d || 0,
        r.detailPageViews || r.dpv14d || 0,
      );
    }

    await pool.query(
      `INSERT INTO ads_sb_campaign_report (
        profile_id, report_date, campaign_id, campaign_name,
        impressions, clicks, spend, sales_14d, orders_14d, units_14d,
        new_to_brand_purchases_14d, new_to_brand_sales_14d, dpv_14d
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT (profile_id, report_date, campaign_id)
      DO UPDATE SET
        campaign_name = EXCLUDED.campaign_name,
        impressions = EXCLUDED.impressions,
        clicks = EXCLUDED.clicks,
        spend = EXCLUDED.spend,
        sales_14d = EXCLUDED.sales_14d,
        orders_14d = EXCLUDED.orders_14d,
        units_14d = EXCLUDED.units_14d,
        new_to_brand_purchases_14d = EXCLUDED.new_to_brand_purchases_14d,
        new_to_brand_sales_14d = EXCLUDED.new_to_brand_sales_14d,
        dpv_14d = EXCLUDED.dpv_14d,
        synced_at = NOW()`,
      values
    );

    total += batch.length;
  }

  logger.info(`[AdsWriter] SB Campaign: ${total} rows for profile ${profileId}`);
  return total;
}

/**
 * Batch upsert SB Search Term report rows (14d attribution).
 */
export async function writeSbSearchTermData(profileId: number, startDate: string, endDate: string, rows: any[]): Promise<number> {
  if (!rows.length) return 0;

  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values: any[] = [];
    const placeholders: string[] = [];

    for (let j = 0; j < batch.length; j++) {
      const r = batch[j];
      const offset = j * 11;
      placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11})`);
      values.push(
        profileId,
        r.date || startDate,
        r.campaignId || null,
        r.campaignName || null,
        r.adGroupId || null,
        r.adGroupName || null,
        r.searchTerm || null,
        r.impressions || 0,
        r.clicks || 0,
        r.cost || r.spend || 0,
        r.sales || r.sales14d || 0,
      );
    }

    await pool.query(
      `INSERT INTO ads_sb_search_term_report (
        profile_id, report_date, campaign_id, campaign_name,
        ad_group_id, ad_group_name, search_term,
        impressions, clicks, spend, sales_14d
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT (profile_id, report_date, campaign_id, ad_group_id, search_term)
      DO UPDATE SET
        campaign_name = EXCLUDED.campaign_name,
        ad_group_name = EXCLUDED.ad_group_name,
        impressions = EXCLUDED.impressions,
        clicks = EXCLUDED.clicks,
        spend = EXCLUDED.spend,
        sales_14d = EXCLUDED.sales_14d,
        synced_at = NOW()`,
      values
    );

    total += batch.length;
  }

  logger.info(`[AdsWriter] SB Search Term: ${total} rows for profile ${profileId}`);
  return total;
}

/**
 * Batch upsert SD Campaign report rows (14d attribution).
 */
export async function writeSdCampaignData(profileId: number, startDate: string, endDate: string, rows: any[]): Promise<number> {
  if (!rows.length) return 0;

  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values: any[] = [];
    const placeholders: string[] = [];

    for (let j = 0; j < batch.length; j++) {
      const r = batch[j];
      const offset = j * 11;
      placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11})`);
      values.push(
        profileId,
        r.date || startDate,
        r.campaignId || null,
        r.campaignName || null,
        r.impressions || 0,
        r.clicks || 0,
        r.cost || r.spend || 0,
        r.salesClicks || r.sales14d || 0,
        r.purchasesClicks || r.purchases14d || 0,
        r.unitsSoldClicks || r.unitsSoldClicks14d || 0,
        r.detailPageViewsClicks || r.dpv14d || 0,
      );
    }

    await pool.query(
      `INSERT INTO ads_sd_campaign_report (
        profile_id, report_date, campaign_id, campaign_name,
        impressions, clicks, spend, sales_14d, orders_14d, units_14d, dpv_14d
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT (profile_id, report_date, campaign_id)
      DO UPDATE SET
        campaign_name = EXCLUDED.campaign_name,
        impressions = EXCLUDED.impressions,
        clicks = EXCLUDED.clicks,
        spend = EXCLUDED.spend,
        sales_14d = EXCLUDED.sales_14d,
        orders_14d = EXCLUDED.orders_14d,
        units_14d = EXCLUDED.units_14d,
        dpv_14d = EXCLUDED.dpv_14d,
        synced_at = NOW()`,
      values
    );

    total += batch.length;
  }

  logger.info(`[AdsWriter] SD Campaign: ${total} rows for profile ${profileId}`);
  return total;
}

/**
 * Batch upsert SD Targeting report rows (14d attribution).
 */
export async function writeSdTargetingData(profileId: number, startDate: string, endDate: string, rows: any[]): Promise<number> {
  if (!rows.length) return 0;

  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values: any[] = [];
    const placeholders: string[] = [];

    for (let j = 0; j < batch.length; j++) {
      const r = batch[j];
      const offset = j * 13;
      placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13})`);
      values.push(
        profileId,
        r.date || startDate,
        r.campaignId || null,
        r.campaignName || null,
        r.adGroupId || null,
        r.adGroupName || null,
        r.targetingText || r.targeting || null,
        r.impressions || 0,
        r.clicks || 0,
        r.cost || r.spend || 0,
        r.salesClicks || r.sales14d || 0,
        r.purchasesClicks || r.purchases14d || 0,
        r.unitsSoldClicks || r.unitsSoldClicks14d || 0,
      );
    }

    await pool.query(
      `INSERT INTO ads_sd_targeting_report (
        profile_id, report_date, campaign_id, campaign_name,
        ad_group_id, ad_group_name, targeting,
        impressions, clicks, spend, sales_14d, orders_14d, units_14d
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT (profile_id, report_date, campaign_id, ad_group_id, targeting)
      DO UPDATE SET
        campaign_name = EXCLUDED.campaign_name,
        ad_group_name = EXCLUDED.ad_group_name,
        impressions = EXCLUDED.impressions,
        clicks = EXCLUDED.clicks,
        spend = EXCLUDED.spend,
        sales_14d = EXCLUDED.sales_14d,
        orders_14d = EXCLUDED.orders_14d,
        units_14d = EXCLUDED.units_14d,
        synced_at = NOW()`,
      values
    );

    total += batch.length;
  }

  logger.info(`[AdsWriter] SD Targeting: ${total} rows for profile ${profileId}`);
  return total;
}

/**
 * Batch upsert SD Advertised Product report rows (14d attribution).
 */
export async function writeSdAdvertisedProductData(profileId: number, startDate: string, endDate: string, rows: any[]): Promise<number> {
  if (!rows.length) return 0;

  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values: any[] = [];
    const placeholders: string[] = [];

    for (let j = 0; j < batch.length; j++) {
      const r = batch[j];
      const offset = j * 14;
      placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14})`);
      values.push(
        profileId,
        r.date || startDate,
        r.campaignId || null,
        r.campaignName || null,
        r.adGroupId || null,
        r.adGroupName || null,
        r.promotedAsin || r.advertisedAsin || null,
        r.promotedSku || r.advertisedSku || null,
        r.impressions || 0,
        r.clicks || 0,
        r.cost || r.spend || 0,
        r.salesClicks || r.sales14d || 0,
        r.purchasesClicks || r.purchases14d || 0,
        r.unitsSoldClicks || r.unitsSoldClicks14d || 0,
      );
    }

    await pool.query(
      `INSERT INTO ads_sd_advertised_product_report (
        profile_id, report_date, campaign_id, campaign_name,
        ad_group_id, ad_group_name, advertised_asin, advertised_sku,
        impressions, clicks, spend, sales_14d, orders_14d, units_14d
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT (profile_id, report_date, campaign_id, ad_group_id, advertised_asin)
      DO UPDATE SET
        campaign_name = EXCLUDED.campaign_name,
        ad_group_name = EXCLUDED.ad_group_name,
        advertised_sku = EXCLUDED.advertised_sku,
        impressions = EXCLUDED.impressions,
        clicks = EXCLUDED.clicks,
        spend = EXCLUDED.spend,
        sales_14d = EXCLUDED.sales_14d,
        orders_14d = EXCLUDED.orders_14d,
        units_14d = EXCLUDED.units_14d,
        synced_at = NOW()`,
      values
    );

    total += batch.length;
  }

  logger.info(`[AdsWriter] SD Advertised Product: ${total} rows for profile ${profileId}`);
  return total;
}

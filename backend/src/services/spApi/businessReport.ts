import { getSpApiClient } from './client';
import { waitForReport } from './reportUtils';
import { pool } from '../../config/database';
import logger from '../../config/logger';
import { MARKETPLACE_IDS } from '../../config/constants';
import type { MarketplaceConfig } from '../../types';

const BATCH_SIZE = 500;

interface BusinessReportRow {
  credential_id: number;
  marketplace_id: string;
  report_date: string;
  parent_asin: string | null;
  child_asin: string;
  title: string | null;
  sessions: number;
  session_percentage: number;
  page_views: number;
  page_views_percentage: number;
  buy_box_percentage: number;
  units_ordered: number;
  units_ordered_b2b: number;
  unit_session_percentage: number;
  unit_session_percentage_b2b: number;
  ordered_product_sales: number;
  ordered_product_sales_b2b: number;
  total_order_items: number;
  total_order_items_b2b: number;
}

/**
 * Fetch GET_SALES_AND_TRAFFIC_REPORT (by child ASIN, daily) for a credential.
 * This report is marketplace-specific — one call per marketplace_id.
 */
export async function fetchBusinessReport(
  marketplace: MarketplaceConfig,
  startDate: Date,
  endDate: Date,
): Promise<number> {
  const credentialId = marketplace.credential_id;
  if (!credentialId) {
    throw new Error(`No credential_id for ${marketplace.country_code}`);
  }

  const client = await getSpApiClient(credentialId);
  const marketplaceId = marketplace.marketplace_id;

  logger.info(`[BusinessReport] Requesting report for ${marketplace.country_code}: ${startDate.toISOString().split('T')[0]} - ${endDate.toISOString().split('T')[0]}`);

  // Step 1: Create report
  const reportResponse: any = await client.callAPI({
    operation: 'createReport',
    endpoint: 'reports',
    body: {
      reportType: 'GET_SALES_AND_TRAFFIC_REPORT',
      marketplaceIds: [marketplaceId],
      dataStartTime: startDate.toISOString(),
      dataEndTime: endDate.toISOString(),
      reportOptions: {
        dateGranularity: 'DAY',
        asinGranularity: 'CHILD',
      },
    },
  });

  const reportId = reportResponse?.reportId;
  if (!reportId) {
    throw new Error(`Failed to create business report for ${marketplace.country_code}`);
  }

  // Step 2: Poll for completion
  const document = await waitForReport(client, reportId);

  // Step 3: Download (JSON format)
  const reportData: any = await client.download(document, { json: true });

  if (!reportData) {
    logger.warn(`[BusinessReport] No data returned for ${marketplace.country_code}`);
    return 0;
  }

  // The report returns { salesAndTrafficByAsin: [...] }
  const asinRows = reportData?.salesAndTrafficByAsin || reportData;
  if (!Array.isArray(asinRows) || asinRows.length === 0) {
    logger.warn(`[BusinessReport] Empty asin data for ${marketplace.country_code}`);
    return 0;
  }

  logger.info(`[BusinessReport] Downloaded ${asinRows.length} ASIN-day rows for ${marketplace.country_code}`);

  // Step 4: Parse and write
  const items: BusinessReportRow[] = [];

  for (const row of asinRows) {
    const childAsin = row.childAsin || row['(Child) ASIN'] || '';
    if (!childAsin) continue;

    const date = row.date || '';
    if (!date) continue;

    const traffic = row.trafficByAsin || {};
    const sales = row.salesByAsin || {};

    items.push({
      credential_id: credentialId,
      marketplace_id: marketplace.country_code,
      report_date: date,
      parent_asin: row.parentAsin || null,
      child_asin: childAsin,
      title: row.title || null,
      sessions: parseInt(traffic.sessions || '0') || 0,
      session_percentage: parseFloat(traffic.sessionPercentage || '0') || 0,
      page_views: parseInt(traffic.pageViews || traffic.browserPageViews || '0') || 0,
      page_views_percentage: parseFloat(traffic.pageViewsPercentage || traffic.browserPageViewsPercentage || '0') || 0,
      buy_box_percentage: parseFloat(traffic.buyBoxPercentage || '0') || 0,
      units_ordered: parseInt(sales.unitsOrdered || '0') || 0,
      units_ordered_b2b: parseInt(sales.unitsOrderedB2B || '0') || 0,
      unit_session_percentage: parseFloat(traffic.unitSessionPercentage || '0') || 0,
      unit_session_percentage_b2b: parseFloat(traffic.unitSessionPercentageB2B || '0') || 0,
      ordered_product_sales: parseFloat(sales.orderedProductSales?.amount || '0') || 0,
      ordered_product_sales_b2b: parseFloat(sales.orderedProductSalesB2B?.amount || '0') || 0,
      total_order_items: parseInt(sales.totalOrderItems || '0') || 0,
      total_order_items_b2b: parseInt(sales.totalOrderItemsB2B || '0') || 0,
    });
  }

  if (items.length === 0) {
    logger.warn(`[BusinessReport] No valid items after parsing for ${marketplace.country_code}`);
    return 0;
  }

  // Batch upsert
  let total = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const values: any[] = [];
    const placeholders: string[] = [];
    const COLS = 19;

    for (let j = 0; j < batch.length; j++) {
      const r = batch[j];
      const offset = j * COLS;
      placeholders.push(`(${Array.from({ length: COLS }, (_, k) => `$${offset + k + 1}`).join(', ')})`);
      values.push(
        r.credential_id, r.marketplace_id, r.report_date, r.parent_asin, r.child_asin,
        r.title, r.sessions, r.session_percentage, r.page_views, r.page_views_percentage,
        r.buy_box_percentage, r.units_ordered, r.units_ordered_b2b,
        r.unit_session_percentage, r.unit_session_percentage_b2b,
        r.ordered_product_sales, r.ordered_product_sales_b2b,
        r.total_order_items, r.total_order_items_b2b,
      );
    }

    await pool.query(
      `INSERT INTO business_report (
        credential_id, marketplace_id, report_date, parent_asin, child_asin,
        title, sessions, session_percentage, page_views, page_views_percentage,
        buy_box_percentage, units_ordered, units_ordered_b2b,
        unit_session_percentage, unit_session_percentage_b2b,
        ordered_product_sales, ordered_product_sales_b2b,
        total_order_items, total_order_items_b2b
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT (credential_id, marketplace_id, report_date, child_asin)
      DO UPDATE SET
        parent_asin = EXCLUDED.parent_asin,
        title = EXCLUDED.title,
        sessions = EXCLUDED.sessions,
        session_percentage = EXCLUDED.session_percentage,
        page_views = EXCLUDED.page_views,
        page_views_percentage = EXCLUDED.page_views_percentage,
        buy_box_percentage = EXCLUDED.buy_box_percentage,
        units_ordered = EXCLUDED.units_ordered,
        units_ordered_b2b = EXCLUDED.units_ordered_b2b,
        unit_session_percentage = EXCLUDED.unit_session_percentage,
        unit_session_percentage_b2b = EXCLUDED.unit_session_percentage_b2b,
        ordered_product_sales = EXCLUDED.ordered_product_sales,
        ordered_product_sales_b2b = EXCLUDED.ordered_product_sales_b2b,
        total_order_items = EXCLUDED.total_order_items,
        total_order_items_b2b = EXCLUDED.total_order_items_b2b,
        synced_at = NOW()`,
      values,
    );

    total += batch.length;
  }

  logger.info(`[BusinessReport] Wrote ${total} rows for ${marketplace.country_code}`);
  return total;
}

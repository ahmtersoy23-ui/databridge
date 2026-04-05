import { getSpApiClient } from './client';
import { waitForReport } from './reportUtils';
import { pool } from '../../config/database';
import logger from '../../config/logger';
import type { MarketplaceConfig } from '../../types';

const BATCH_SIZE = 500;

interface SqpRow {
  credential_id: number;
  marketplace_id: string;
  report_date: string;
  department: string | null;
  search_term: string;
  search_frequency_rank: number | null;
  click_share: number;
  conversion_share: number;
  clicked_asin: string | null;
  clicked_asin_product_name: string | null;
}

/**
 * Fetch GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT for a marketplace.
 * Brand Analytics reports are weekly (week ending Sunday) with 3-4 day lag.
 * reportOptions: reportPeriod = 'WEEK', optional reporting_date_start/end
 */
export async function fetchBrandAnalyticsSqp(
  marketplace: MarketplaceConfig,
  startDate: Date,
  endDate: Date,
): Promise<number> {
  const credentialId = marketplace.credential_id;
  if (!credentialId) {
    throw new Error(`No credential_id for ${marketplace.country_code}`);
  }

  const client = await getSpApiClient(credentialId);

  logger.info(`[BrandAnalyticsSQP] Requesting report for ${marketplace.country_code}: ${startDate.toISOString().split('T')[0]} - ${endDate.toISOString().split('T')[0]}`);

  // Step 1: Create report
  const reportResponse: any = await client.callAPI({
    operation: 'createReport',
    endpoint: 'reports',
    body: {
      reportType: 'GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT',
      marketplaceIds: [marketplace.marketplace_id],
      dataStartTime: startDate.toISOString(),
      dataEndTime: endDate.toISOString(),
      reportOptions: {
        reportPeriod: 'WEEK',
      },
    },
  });

  const reportId = reportResponse?.reportId;
  if (!reportId) {
    throw new Error(`Failed to create SQP report for ${marketplace.country_code}`);
  }

  // Step 2: Poll for completion
  const document = await waitForReport(client, reportId);

  // Step 3: Download (JSON format)
  const reportData: any = await client.download(document, { json: true });

  if (!reportData) {
    logger.warn(`[BrandAnalyticsSQP] No data returned for ${marketplace.country_code}`);
    return 0;
  }

  // The report returns { dataByDepartmentAndSearchTerm: [...] }
  const rows = reportData?.dataByDepartmentAndSearchTerm || reportData;
  if (!Array.isArray(rows) || rows.length === 0) {
    logger.warn(`[BrandAnalyticsSQP] Empty data for ${marketplace.country_code}`);
    return 0;
  }

  logger.info(`[BrandAnalyticsSQP] Downloaded ${rows.length} search term entries for ${marketplace.country_code}`);

  // Step 4: Parse — each row has up to 3 clicked ASINs
  const reportDateStr = startDate.toISOString().split('T')[0]; // week start
  const items: SqpRow[] = [];

  for (const row of rows) {
    const searchTerm = row.departmentName ? undefined : row.searchTerm;
    const term = searchTerm || row.searchTerm || '';
    if (!term) continue;

    const sfRank = parseInt(row.searchFrequencyRank || '0') || null;
    const department = row.departmentName || null;

    // Up to 3 clicked ASINs
    for (let i = 1; i <= 3; i++) {
      const asinKey = `clickedAsin${i}` in row ? `clickedAsin${i}` : undefined;
      const asinObj = row[`clickedAsin${i}`] || row[`asin${i}`];
      if (!asinObj) continue;

      const asin = typeof asinObj === 'string' ? asinObj : (asinObj.asin || '');
      if (!asin) continue;

      items.push({
        credential_id: credentialId,
        marketplace_id: marketplace.country_code,
        report_date: reportDateStr,
        department,
        search_term: term,
        search_frequency_rank: sfRank,
        click_share: parseFloat(asinObj.clickShare || asinObj[`clickShare${i}`] || row[`clickShare${i}`] || '0') || 0,
        conversion_share: parseFloat(asinObj.conversionShare || asinObj[`conversionShare${i}`] || row[`conversionShare${i}`] || '0') || 0,
        clicked_asin: asin,
        clicked_asin_product_name: asinObj.productName || asinObj.productTitle || null,
      });
    }
  }

  if (items.length === 0) {
    logger.warn(`[BrandAnalyticsSQP] No valid items after parsing for ${marketplace.country_code}`);
    return 0;
  }

  // Batch upsert
  let total = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const values: any[] = [];
    const placeholders: string[] = [];
    const COLS = 10;

    for (let j = 0; j < batch.length; j++) {
      const r = batch[j];
      const offset = j * COLS;
      placeholders.push(`(${Array.from({ length: COLS }, (_, k) => `$${offset + k + 1}`).join(', ')})`);
      values.push(
        r.credential_id, r.marketplace_id, r.report_date, r.department,
        r.search_term, r.search_frequency_rank, r.click_share, r.conversion_share,
        r.clicked_asin, r.clicked_asin_product_name,
      );
    }

    await pool.query(
      `INSERT INTO brand_analytics_sqp (
        credential_id, marketplace_id, report_date, department,
        search_term, search_frequency_rank, click_share, conversion_share,
        clicked_asin, clicked_asin_product_name
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT (credential_id, marketplace_id, report_date, search_term, clicked_asin)
      DO UPDATE SET
        department = EXCLUDED.department,
        search_frequency_rank = EXCLUDED.search_frequency_rank,
        click_share = EXCLUDED.click_share,
        conversion_share = EXCLUDED.conversion_share,
        clicked_asin_product_name = EXCLUDED.clicked_asin_product_name,
        synced_at = NOW()`,
      values,
    );

    total += batch.length;
  }

  logger.info(`[BrandAnalyticsSQP] Wrote ${total} rows for ${marketplace.country_code}`);
  return total;
}

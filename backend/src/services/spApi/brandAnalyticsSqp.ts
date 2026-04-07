import { getSpApiClient } from './client';
import { waitForReport } from './reportUtils';
import { pool, sharedPool } from '../../config/database';
import logger from '../../config/logger';
import type { MarketplaceConfig } from '../../types';
import axios from 'axios';
import { createGunzip } from 'zlib';
import { parser } from 'stream-json';
import { streamArray } from 'stream-json/streamers/StreamArray';
import { pick } from 'stream-json/filters/Pick';
import { Readable } from 'stream';

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
 * Load our ASIN set from ads_product_ads_snapshot + sku_master for filtering.
 * Only keep Brand Analytics rows where one of clicked ASINs is ours.
 */
async function loadOurAsins(): Promise<Set<string>> {
  // From ads snapshot (active ads)
  const adsResult = await pool.query(
    `SELECT DISTINCT asin FROM ads_product_ads_snapshot WHERE asin IS NOT NULL`
  );
  // From sku_master (all products)
  const skuResult = await sharedPool.query(
    `SELECT DISTINCT asin FROM sku_master WHERE asin IS NOT NULL AND asin != ''`
  );
  const asins = new Set<string>();
  for (const r of adsResult.rows) asins.add(r.asin);
  for (const r of skuResult.rows) asins.add(r.asin);
  return asins;
}

/**
 * Parse a single BA row into SqpRow items (up to 3 clicked ASINs per row).
 * Returns only items where clicked_asin is in our ASIN set.
 */
function parseRow(
  row: any,
  credentialId: number,
  marketplaceCode: string,
  reportDateStr: string,
  ourAsins: Set<string>,
): SqpRow[] {
  const term = row.searchTerm || '';
  if (!term) return [];

  const sfRank = parseInt(row.searchFrequencyRank || '0') || null;
  const department = row.departmentName || null;
  const items: SqpRow[] = [];

  for (let i = 1; i <= 3; i++) {
    const asinObj = row[`clickedAsin${i}`] || row[`asin${i}`];
    if (!asinObj) continue;

    const asin = typeof asinObj === 'string' ? asinObj : (asinObj.asin || '');
    if (!asin || !ourAsins.has(asin)) continue;

    items.push({
      credential_id: credentialId,
      marketplace_id: marketplaceCode,
      report_date: reportDateStr,
      department,
      search_term: term,
      search_frequency_rank: sfRank,
      click_share: parseFloat(asinObj.clickShare || row[`clickShare${i}`] || '0') || 0,
      conversion_share: parseFloat(asinObj.conversionShare || row[`conversionShare${i}`] || '0') || 0,
      clicked_asin: asin,
      clicked_asin_product_name: asinObj.productName || asinObj.productTitle || null,
    });
  }

  return items;
}

/**
 * Batch upsert SqpRow items into brand_analytics_sqp.
 */
async function writeBatch(items: SqpRow[]): Promise<number> {
  if (!items.length) return 0;

  const values: any[] = [];
  const placeholders: string[] = [];
  const COLS = 10;

  for (let j = 0; j < items.length; j++) {
    const r = items[j];
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

  return items.length;
}

/**
 * Fetch GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT using stream processing.
 *
 * The US weekly report is ~600MB compressed (millions of rows).
 * We stream-parse the JSON, filtering to only rows containing our ASINs.
 * Peak memory: ~50MB instead of ~4GB.
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
  const reportDateStr = startDate.toISOString().split('T')[0];

  logger.info(`[BrandAnalyticsSQP] Requesting report for ${marketplace.country_code}: ${reportDateStr} - ${endDate.toISOString().split('T')[0]}`);

  // Step 1: Create report
  const reportResponse: any = await client.callAPI({
    operation: 'createReport',
    endpoint: 'reports',
    body: {
      reportType: 'GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT',
      marketplaceIds: [marketplace.marketplace_id],
      dataStartTime: startDate.toISOString(),
      dataEndTime: endDate.toISOString(),
      reportOptions: { reportPeriod: 'WEEK' },
    },
  });

  const reportId = reportResponse?.reportId;
  if (!reportId) {
    throw new Error(`Failed to create SQP report for ${marketplace.country_code}`);
  }

  // Step 2: Poll for completion
  const document = await waitForReport(client, reportId);

  // Step 3: Load our ASINs for filtering
  const ourAsins = await loadOurAsins();
  logger.info(`[BrandAnalyticsSQP] Loaded ${ourAsins.size} ASINs for filtering`);

  // Step 4: Stream download → gunzip → JSON stream parse → filter → batch write
  logger.info(`[BrandAnalyticsSQP] Streaming download for ${marketplace.country_code}...`);

  const response = await axios.get(document.url, {
    responseType: 'stream',
    timeout: 600_000, // 10 min — large file
  });

  return new Promise<number>((resolve, reject) => {
    let totalWritten = 0;
    let batch: SqpRow[] = [];
    let rowsScanned = 0;

    const pipeline = response.data
      .pipe(createGunzip())
      .pipe(parser())
      .pipe(pick({ filter: 'dataByDepartmentAndSearchTerm' }))
      .pipe(streamArray());

    pipeline.on('data', async ({ value }: { value: any }) => {
      rowsScanned++;

      const items = parseRow(value, credentialId, marketplace.country_code, reportDateStr, ourAsins);
      if (items.length > 0) {
        batch.push(...items);
      }

      // Flush batch
      if (batch.length >= BATCH_SIZE) {
        pipeline.pause();
        try {
          totalWritten += await writeBatch(batch);
          batch = [];
        } catch (err) {
          pipeline.destroy();
          reject(err);
          return;
        }
        pipeline.resume();
      }

      // Progress log every 500K rows
      if (rowsScanned % 500_000 === 0) {
        logger.info(`[BrandAnalyticsSQP] ${marketplace.country_code}: scanned ${(rowsScanned / 1000).toFixed(0)}K rows, matched ${totalWritten}`);
      }
    });

    pipeline.on('end', async () => {
      try {
        // Flush remaining
        if (batch.length > 0) {
          totalWritten += await writeBatch(batch);
        }
        logger.info(`[BrandAnalyticsSQP] ${marketplace.country_code}: scanned ${rowsScanned} rows, wrote ${totalWritten} (our ASINs)`);
        resolve(totalWritten);
      } catch (err) {
        reject(err);
      }
    });

    pipeline.on('error', (err: Error) => {
      logger.error(`[BrandAnalyticsSQP] Stream error for ${marketplace.country_code}: ${err.message}`);
      reject(err);
    });
  });
}

import { AxiosInstance } from 'axios';
import { createGunzip } from 'zlib';
import { Readable } from 'stream';
import axios from 'axios';
import logger from '../../config/logger';
import type { AdsReportType, SbReportType, AdsReportStatusResponse } from '../../types/ads';
import { ADS_REPORT_TYPE_MAP, SB_REPORT_TYPE_MAP, ADS_REPORT_COLUMNS, ADS_REPORT_GROUP_BY, ADS_REPORT_AD_PRODUCT } from '../../types/ads';

/**
 * Create an Ads API V3 async report.
 * Returns the report ID for polling.
 */
export async function createAdsReport(
  client: AxiosInstance,
  reportType: AdsReportType | SbReportType,
  startDate: string,
  endDate: string,
): Promise<string> {
  const reportTypeId = (ADS_REPORT_TYPE_MAP as any)[reportType] || (SB_REPORT_TYPE_MAP as any)[reportType];
  const body = {
    name: `DataBridge ${reportType} ${startDate}`,
    startDate,
    endDate,
    configuration: {
      adProduct: ADS_REPORT_AD_PRODUCT[reportType],
      groupBy: ADS_REPORT_GROUP_BY[reportType],
      columns: ADS_REPORT_COLUMNS[reportType],
      reportTypeId,
      timeUnit: 'DAILY',
      format: 'GZIP_JSON',
    },
  };

  const res = await client.post('/reporting/reports', body, {
    headers: { 'Content-Type': 'application/vnd.createasyncreportrequest.v3+json' },
  });
  const reportId = res.data?.reportId;

  if (!reportId) {
    throw new Error(`Failed to create ${reportType} report: no reportId returned`);
  }

  logger.info(`[AdsAPI] Created ${reportType} report: ${reportId} (${startDate} → ${endDate})`);
  return reportId;
}

/**
 * Poll Ads API for report completion with exponential backoff.
 * Returns the download URL when ready.
 */
export async function waitForAdsReport(
  client: AxiosInstance,
  reportId: string,
  maxAttempts = 15,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await client.get(`/reporting/reports/${reportId}`);
    const report: AdsReportStatusResponse = res.data;

    if (report.status === 'COMPLETED') {
      if (!report.url) throw new Error(`Report ${reportId} completed but no download URL`);
      logger.info(`[AdsAPI] Report ${reportId} completed (${report.fileSize ?? '?'} bytes)`);
      return report.url;
    }

    if (report.status === 'FAILED') {
      throw new Error(`Report ${reportId} failed: ${report.failureReason || 'unknown'}`);
    }

    // Exponential backoff: 10s, 15s, 20s, ... up to 60s
    const waitMs = Math.min(10_000 + attempt * 5_000, 60_000);
    logger.debug(`[AdsAPI] Report ${reportId} status: ${report.status}, waiting ${waitMs}ms...`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }

  throw new Error(`Report ${reportId} timed out after ${maxAttempts} attempts`);
}

/**
 * Download and decompress a GZIP_JSON report from the given URL.
 * Returns parsed JSON array of report rows.
 */
export async function downloadAdsReport<T = Record<string, any>>(url: string): Promise<T[]> {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 120_000,
  });

  const buffer = Buffer.from(res.data);

  // Decompress GZIP
  const decompressed = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const gunzip = createGunzip();
    const stream = Readable.from(buffer);

    stream.pipe(gunzip);
    gunzip.on('data', (chunk: Buffer) => chunks.push(chunk));
    gunzip.on('end', () => resolve(Buffer.concat(chunks)));
    gunzip.on('error', reject);
  });

  const json = JSON.parse(decompressed.toString('utf-8'));

  // V3 reports return an array directly
  if (Array.isArray(json)) return json;

  // Some reports wrap in an object
  if (json.rows && Array.isArray(json.rows)) return json.rows;

  logger.warn('[AdsAPI] Unexpected report format, returning as-is');
  return Array.isArray(json) ? json : [json];
}

/**
 * Find a pending/running report for the same type and download it.
 * Amazon returns 425 when a duplicate report already exists — reuse it instead.
 */
async function findAndDownloadPendingReport<T>(
  client: AxiosInstance,
  reportType: AdsReportType | SbReportType,
): Promise<T[] | null> {
  try {
    // Query ads_sync_jobs for the most recent report ID of this type
    const { pool } = await import('../../config/database');
    const result = await pool.query(
      `SELECT amazon_report_id FROM ads_sync_jobs
       WHERE report_type = $1 AND amazon_report_id IS NOT NULL AND status IN ('running', 'failed')
       ORDER BY id DESC LIMIT 1`,
      [reportType]
    );

    if (result.rows[0]?.amazon_report_id) {
      const reportId = result.rows[0].amazon_report_id;
      logger.info(`[AdsAPI] 425 recovery: polling existing report ${reportId} for ${reportType}`);
      const downloadUrl = await waitForAdsReport(client, reportId);
      return await downloadAdsReport<T>(downloadUrl);
    }
  } catch (err: any) {
    logger.warn(`[AdsAPI] 425 recovery failed for ${reportType}: ${err.message}`);
  }
  return null;
}

/**
 * Full pipeline: create report → poll → download → return rows.
 * On 425 (duplicate report), tries to recover by polling the existing report.
 */
export async function fetchAdsReport<T = Record<string, any>>(
  client: AxiosInstance,
  reportType: AdsReportType | SbReportType,
  startDate: string,
  endDate: string,
): Promise<T[]> {
  let reportId: string;

  try {
    reportId = await createAdsReport(client, reportType, startDate, endDate);
  } catch (err: any) {
    if (err.response?.status === 425) {
      logger.warn(`[AdsAPI] 425 for ${reportType} — attempting recovery from existing report`);
      const recovered = await findAndDownloadPendingReport<T>(client, reportType);
      if (recovered) {
        logger.info(`[AdsAPI] 425 recovery succeeded for ${reportType}: ${recovered.length} rows`);
        return recovered;
      }
      throw new Error(`425 Too Early for ${reportType} and no recoverable report found`);
    }
    throw err;
  }

  // Save reportId to current sync job for future 425 recovery
  try {
    const { pool } = await import('../../config/database');
    await pool.query(
      `UPDATE ads_sync_jobs SET amazon_report_id = $1
       WHERE id = (SELECT id FROM ads_sync_jobs WHERE report_type = $2 AND status = 'running' AND amazon_report_id IS NULL ORDER BY id DESC LIMIT 1)`,
      [reportId, reportType]
    );
  } catch { /* non-critical */ }

  const downloadUrl = await waitForAdsReport(client, reportId);
  const rows = await downloadAdsReport<T>(downloadUrl);

  logger.info(`[AdsAPI] Fetched ${rows.length} rows for ${reportType} (${startDate} → ${endDate})`);
  return rows;
}

import { AxiosInstance } from 'axios';
import { createGunzip } from 'zlib';
import { Readable } from 'stream';
import axios from 'axios';
import logger from '../../config/logger';
import type { AdsReportType, AdsReportStatusResponse } from '../../types/ads';
import { ADS_REPORT_TYPE_MAP, ADS_REPORT_COLUMNS, ADS_REPORT_GROUP_BY } from '../../types/ads';

/**
 * Create an Ads API V3 async report.
 * Returns the report ID for polling.
 */
export async function createAdsReport(
  client: AxiosInstance,
  reportType: AdsReportType,
  startDate: string,
  endDate: string,
): Promise<string> {
  const body = {
    name: `DataBridge ${reportType} ${startDate}`,
    startDate,
    endDate,
    configuration: {
      adProduct: 'SPONSORED_PRODUCTS',
      groupBy: ADS_REPORT_GROUP_BY[reportType],
      columns: ADS_REPORT_COLUMNS[reportType],
      reportTypeId: ADS_REPORT_TYPE_MAP[reportType],
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
 * Full pipeline: create report → poll → download → return rows.
 */
export async function fetchAdsReport<T = Record<string, any>>(
  client: AxiosInstance,
  reportType: AdsReportType,
  startDate: string,
  endDate: string,
): Promise<T[]> {
  const reportId = await createAdsReport(client, reportType, startDate, endDate);
  const downloadUrl = await waitForAdsReport(client, reportId);
  const rows = await downloadAdsReport<T>(downloadUrl);

  logger.info(`[AdsAPI] Fetched ${rows.length} rows for ${reportType} (${startDate} → ${endDate})`);
  return rows;
}

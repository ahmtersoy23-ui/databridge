import { SellingPartner } from 'amazon-sp-api';
import logger from '../../config/logger';

/**
 * Poll SP-API for report completion with exponential backoff.
 * Returns the report document object when ready.
 */
export async function waitForReport(client: SellingPartner, reportId: string, maxAttempts = 30): Promise<any> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const report: any = await client.callAPI({
      operation: 'getReport',
      endpoint: 'reports',
      path: { reportId },
    });

    const status = report?.processingStatus;

    if (status === 'DONE') {
      const docId = report.reportDocumentId;
      return client.callAPI({
        operation: 'getReportDocument',
        endpoint: 'reports',
        path: { reportDocumentId: docId },
      });
    }

    if (status === 'CANCELLED' || status === 'FATAL') {
      throw new Error(`Report ${reportId} failed with status: ${status}`);
    }

    // Exponential backoff: 10s, 15s, 20s, ... up to 60s
    const waitMs = Math.min(10_000 + attempt * 5_000, 60_000);
    logger.debug(`[SP-API] Report ${reportId} status: ${status}, waiting ${waitMs}ms...`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }

  throw new Error(`Report ${reportId} timed out after ${maxAttempts} attempts`);
}

/**
 * Convert a UTC date to marketplace local date string (YYYY-MM-DD).
 */
export function toMarketplaceLocalDate(utcDate: Date, timezoneOffset: number): string {
  const localMs = utcDate.getTime() + timezoneOffset * 60 * 60 * 1000;
  const localDate = new Date(localMs);
  return localDate.toISOString().split('T')[0]; // YYYY-MM-DD
}

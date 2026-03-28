import { pool } from '../../config/database';
import logger from '../../config/logger';
import { getAdsClient, getActiveProfiles } from './client';
import { fetchAdsReport } from './reports';
import { writeSearchTermData, writeTargetingData, writeAdvertisedProductData, writePurchasedProductData } from './adsDataWriter';
import { withRetry } from '../../utils/retry';
import type { AdsReportType } from '../../types/ads';

const REPORT_TYPES: AdsReportType[] = ['search_term', 'targeting', 'advertised_product', 'purchased_product'];

// Default sync window: last 14 days (7-day attribution window)
const DEFAULT_LOOKBACK_DAYS = 14;

/**
 * Create a sync job record in ads_sync_jobs.
 */
async function createSyncJob(profileId: number, reportType: AdsReportType, startDate: string, endDate: string): Promise<number> {
  const result = await pool.query(
    `INSERT INTO ads_sync_jobs (profile_id, report_type, date_start, date_end, status, started_at)
     VALUES ($1, $2, $3, $4, 'running', NOW())
     RETURNING id`,
    [profileId, reportType, startDate, endDate]
  );
  return result.rows[0].id;
}

/**
 * Update a sync job with completion status.
 */
async function completeSyncJob(jobId: number, records: number): Promise<void> {
  await pool.query(
    `UPDATE ads_sync_jobs SET status = 'completed', completed_at = NOW(), records_processed = $1 WHERE id = $2`,
    [records, jobId]
  );
}

/**
 * Update a sync job with failure status.
 */
async function failSyncJob(jobId: number, errorMessage: string): Promise<void> {
  await pool.query(
    `UPDATE ads_sync_jobs SET status = 'failed', completed_at = NOW(), error_message = $1 WHERE id = $2`,
    [errorMessage.slice(0, 1000), jobId]
  );
}

/**
 * Get date range for sync (YYYY-MM-DD strings).
 */
function getDateRange(lookbackDays: number): { startDate: string; endDate: string } {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1); // yesterday (today's data not available)
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - lookbackDays + 1);

  return {
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0],
  };
}

/**
 * Writer function selector based on report type.
 */
function getWriter(reportType: AdsReportType) {
  switch (reportType) {
    case 'search_term': return writeSearchTermData;
    case 'targeting': return writeTargetingData;
    case 'advertised_product': return writeAdvertisedProductData;
    case 'purchased_product': return writePurchasedProductData;
  }
}

/**
 * Sync all 4 report types for a single profile.
 */
export async function syncAdsForProfile(
  credentialId: number,
  profileId: number,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
): Promise<{ total: number; errors: string[] }> {
  const { startDate, endDate } = getDateRange(lookbackDays);
  const client = await getAdsClient(credentialId, profileId);
  let total = 0;
  const errors: string[] = [];

  for (const reportType of REPORT_TYPES) {
    const jobId = await createSyncJob(profileId, reportType, startDate, endDate);

    try {
      const rows = await withRetry(
        () => fetchAdsReport(client, reportType, startDate, endDate),
        { label: `ads:${reportType}:${profileId}`, maxRetries: 2 }
      );

      const writer = getWriter(reportType);
      const count = await writer(profileId, startDate, endDate, rows);

      await completeSyncJob(jobId, count);
      total += count;

      logger.info(`[AdsSync] ${reportType}: ${count} rows for profile ${profileId}`);
    } catch (err: any) {
      await failSyncJob(jobId, err.message);
      errors.push(`${reportType}: ${err.message}`);
      logger.error(`[AdsSync] ${reportType} failed for profile ${profileId}: ${err.message}`);
    }

    // Small delay between report types to respect rate limits
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }

  return { total, errors };
}

/**
 * Sync all active profiles (called by scheduler).
 */
export async function syncAllAdsProfiles(lookbackDays = DEFAULT_LOOKBACK_DAYS): Promise<void> {
  const profiles = await getActiveProfiles();

  if (!profiles.length) {
    logger.info('[AdsSync] No active Ads profiles found');
    return;
  }

  logger.info(`[AdsSync] Starting sync for ${profiles.length} profiles (${lookbackDays} day lookback)`);

  for (const profile of profiles) {
    try {
      const { total, errors } = await syncAdsForProfile(
        profile.credential_id,
        profile.profile_id,
        lookbackDays,
      );

      if (errors.length) {
        logger.warn(`[AdsSync] Profile ${profile.profile_id} (${profile.country_code}): ${total} rows, ${errors.length} errors`);
      } else {
        logger.info(`[AdsSync] Profile ${profile.profile_id} (${profile.country_code}): ${total} rows synced`);
      }
    } catch (err: any) {
      logger.error(`[AdsSync] Profile ${profile.profile_id} (${profile.country_code}) failed: ${err.message}`);
    }

    // Delay between profiles
    await new Promise(resolve => setTimeout(resolve, 5_000));
  }

  logger.info('[AdsSync] Sync cycle complete');
}

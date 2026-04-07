import { Router, Request, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { pool } from '../config/database';
import { getActiveProfiles, discoverProfiles, getAdsCredentials } from '../services/adsApi/client';
import { syncAdsForProfile, syncAllAdsProfiles, syncAllSbProfiles, syncAllSdProfiles } from '../services/adsApi/adsSync';
import { writeSearchTermData, writeTargetingData, writeAdvertisedProductData, writePurchasedProductData } from '../services/adsApi/adsDataWriter';
import { writeCampaignReportData, writeSbCampaignData, writeSbSearchTermData, writeSdCampaignData, writeSdTargetingData, writeSdAdvertisedProductData } from '../services/adsApi/adsDataWriterTier1';
import { encryptCredential } from '../utils/crypto';
import { validateBody } from '../middleware/validate';
import logger from '../config/logger';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const router = Router();

// GET /api/v1/ads/profiles — List all Ads profiles
router.get('/profiles', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT ap.*, cred.account_name as credential_name, cred.region
      FROM ads_api_profiles ap
      JOIN sp_api_credentials cred ON ap.credential_id = cred.id
      ORDER BY ap.country_code
    `);
    res.json({ success: true, data: result.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/ads/profiles/discover — Discover profiles from Amazon
const discoverSchema = z.object({
  credential_id: z.number().int().positive(),
});

router.post('/profiles/discover', validateBody(discoverSchema), async (req: Request, res: Response) => {
  const { credential_id } = req.body;
  try {
    const count = await discoverProfiles(credential_id);
    res.json({ success: true, message: `Discovered ${count} profiles`, count });
  } catch (err: any) {
    logger.error(`[AdsRoute] Profile discovery failed: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/v1/ads/profiles/:id/toggle — Toggle profile active status
router.patch('/profiles/:id/toggle', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE ads_api_profiles SET is_active = NOT is_active, updated_at = NOW() WHERE id = $1 RETURNING id, is_active`,
      [id]
    );
    if (!result.rows.length) {
      res.status(404).json({ success: false, error: 'Profile not found' });
      return;
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/v1/ads/credentials/:id — Save ads_refresh_token for an SP-API credential
const credentialSchema = z.object({
  ads_refresh_token: z.string().min(1),
});

router.put('/credentials/:id', validateBody(credentialSchema), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { ads_refresh_token } = req.body;
  try {
    const encrypted = encryptCredential(ads_refresh_token);
    const result = await pool.query(
      `UPDATE sp_api_credentials SET ads_refresh_token = $1 WHERE id = $2 RETURNING id, account_name`,
      [encrypted, id]
    );
    if (!result.rows.length) {
      res.status(404).json({ success: false, error: 'Credential not found' });
      return;
    }
    res.json({ success: true, message: `Ads refresh token saved for ${result.rows[0].account_name}` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/ads/credentials — List SP-API credentials with ads token status
router.get('/credentials', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT id, region, account_name, is_active,
             CASE WHEN ads_refresh_token IS NOT NULL THEN true ELSE false END as has_ads_token
      FROM sp_api_credentials
      ORDER BY id
    `);
    res.json({ success: true, data: result.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/ads/sync/status — Last sync status per profile
router.get('/sync/status', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (profile_id, report_type)
        asj.*, ap.country_code, ap.account_name
      FROM ads_sync_jobs asj
      JOIN ads_api_profiles ap ON asj.profile_id = ap.profile_id
      ORDER BY profile_id, report_type, created_at DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/ads/sync/jobs — Recent ads sync jobs
router.get('/sync/jobs', async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  try {
    const result = await pool.query(`
      SELECT asj.*, ap.country_code, ap.account_name
      FROM ads_sync_jobs asj
      JOIN ads_api_profiles ap ON asj.profile_id = ap.profile_id
      ORDER BY asj.created_at DESC
      LIMIT $1
    `, [limit]);
    res.json({ success: true, data: result.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/ads/sync/trigger — Manual sync trigger (SP/SB/SD/all)
const triggerSchema = z.object({
  profile_id: z.number().int().positive().optional(),
  lookback_days: z.number().int().min(1).max(90).optional(),
  ad_product: z.enum(['sp', 'sb', 'sd', 'all']).optional(),
});

router.post('/sync/trigger', validateBody(triggerSchema), async (req: Request, res: Response) => {
  const { profile_id, lookback_days, ad_product } = req.body;
  const days = lookback_days || 14;
  const product = ad_product || 'sp';

  try {
    if (profile_id) {
      const profileResult = await pool.query(
        'SELECT ap.credential_id, ap.profile_id, ap.country_code FROM ads_api_profiles ap WHERE ap.profile_id = $1 AND ap.is_active = true',
        [profile_id]
      );
      if (!profileResult.rows.length) {
        res.status(404).json({ success: false, error: 'Profile not found or inactive' });
        return;
      }

      const profile = profileResult.rows[0];
      syncAdsForProfile(profile.credential_id, profile.profile_id, days)
        .catch(err => logger.error(`[AdsRoute] Manual sync error: ${err.message}`));

      res.json({ success: true, message: `SP sync started for profile ${profile.country_code} (${days} days)` });
    } else {
      // Sync all profiles for selected ad product(s)
      const targets: string[] = [];

      if (product === 'all' || product === 'sp') {
        syncAllAdsProfiles(days).catch(err => logger.error(`[AdsRoute] SP sync error: ${err.message}`));
        targets.push('SP');
      }
      if (product === 'all' || product === 'sb') {
        syncAllSbProfiles(days).catch(err => logger.error(`[AdsRoute] SB sync error: ${err.message}`));
        targets.push('SB');
      }
      if (product === 'all' || product === 'sd') {
        syncAllSdProfiles(days).catch(err => logger.error(`[AdsRoute] SD sync error: ${err.message}`));
        targets.push('SD');
      }

      res.json({ success: true, message: `${targets.join('+')} sync started for all active profiles (${days} days)` });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Excel/CSV Backfill Upload ─────────────────────────────────

type ReportType = 'sp_search_term' | 'sp_targeting' | 'sp_advertised_product' | 'sp_purchased_product' | 'sp_campaign'
  | 'sb_campaign' | 'sb_search_term'
  | 'sd_campaign' | 'sd_targeting' | 'sd_advertised_product';

const WRITER_MAP: Record<ReportType, (profileId: number, startDate: string, endDate: string, rows: any[]) => Promise<number>> = {
  sp_search_term: writeSearchTermData,
  sp_targeting: writeTargetingData,
  sp_advertised_product: writeAdvertisedProductData,
  sp_purchased_product: writePurchasedProductData,
  sp_campaign: writeCampaignReportData,
  sb_campaign: writeSbCampaignData,
  sb_search_term: writeSbSearchTermData,
  sd_campaign: writeSdCampaignData,
  sd_targeting: writeSdTargetingData,
  sd_advertised_product: writeSdAdvertisedProductData,
};

/**
 * Parse CSV/TSV content into array of objects.
 * Handles Excel-exported CSVs (comma or tab separated).
 */
function parseCsv(content: string): any[] {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const sep = lines[0].includes('\t') ? '\t' : ',';
  const headers = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, ''));

  return lines.slice(1).map(line => {
    const values = line.split(sep).map(v => v.trim().replace(/^"|"$/g, ''));
    const obj: any = {};
    headers.forEach((h, i) => { obj[h] = values[i] || ''; });
    return obj;
  });
}

/**
 * Normalize Amazon Ads Console column names to V3 API field names.
 * Console exports use human-readable names like "7 Day Total Sales (#)"
 */
function normalizeRow(row: any): any {
  const normalized: any = {};
  const map: Record<string, string> = {
    // Date
    'Date': 'date', 'Start Date': 'date',
    // Campaign
    'Campaign Name': 'campaignName', 'Campaign Id': 'campaignId', 'Campaign ID': 'campaignId',
    'Campaign Status': 'campaignStatus', 'Budget': 'campaignBudgetAmount',
    // Ad Group
    'Ad Group Name': 'adGroupName', 'Ad Group Id': 'adGroupId', 'Ad Group ID': 'adGroupId',
    // Targeting
    'Targeting': 'targeting', 'Match Type': 'matchType',
    'Customer Search Term': 'searchTerm', 'Search Term': 'searchTerm',
    // ASIN
    'Advertised ASIN': 'advertisedAsin', 'Advertised SKU': 'advertisedSku',
    'Purchased ASIN': 'purchasedAsin',
    // SD specific
    'Promoted ASIN': 'promotedAsin', 'Promoted SKU': 'promotedSku',
    'Targeting Text': 'targetingText',
    // Metrics — SP (7d)
    'Impressions': 'impressions', 'Clicks': 'clicks', 'Spend': 'spend', 'Cost': 'cost',
    'Cost Per Click (CPC)': 'costPerClick', 'CPC': 'costPerClick',
    '7 Day Total Sales': 'sales7d', '7 Day Total Sales (#)': 'sales7d',
    '7 Day Total Orders (#)': 'purchases7d', '7 Day Total Units (#)': 'unitsSoldClicks7d',
    '7 Day Advertised SKU Units (#)': 'unitsSoldSameSku7d',
    '7 Day Other SKU Units (#)': 'unitsSoldOtherSku7d',
    '7 Day Advertised SKU Sales': 'attributedSalesSameSku7d',
    '7 Day Other SKU Sales': 'salesOtherSku7d',
    // Metrics — SB/SD (14d)
    '14 Day Total Sales': 'sales', '14 Day Total Sales (#)': 'sales',
    '14 Day Total Orders (#)': 'purchases', '14 Day Total Units (#)': 'unitsSold',
    'New-to-brand Purchases': 'newToBrandPurchases', 'New-to-brand Sales': 'newToBrandSales',
    'Detail Page Views (DPV)': 'detailPageViews', 'DPV': 'detailPageViews',
    // SD clicks-based
    'Purchases (Clicks)': 'purchasesClicks', 'Sales (Clicks)': 'salesClicks',
    'Units Sold (Clicks)': 'unitsSoldClicks', 'Detail Page Views (Clicks)': 'detailPageViewsClicks',
    // Top of Search
    'Top of Search Impression Share': 'topOfSearchImpressionShare',
    // Placement
    'Placement': 'placementClassification',
    // Portfolio
    'Portfolio name': 'portfolioId', 'Portfolio Name': 'portfolioId',
    'Currency': 'campaignBudgetCurrencyCode',
  };

  for (const [key, value] of Object.entries(row)) {
    const mapped = map[key] || key;
    // Clean numeric values: remove $, %, commas
    const cleaned = typeof value === 'string' ? value.replace(/[$%,]/g, '').trim() : value;
    normalized[mapped] = cleaned;
  }

  return normalized;
}

// POST /api/v1/ads/backfill/upload — Upload CSV/Excel for backfill
router.post('/backfill/upload', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ success: false, error: 'No file uploaded' });
    return;
  }

  const reportType = req.body.report_type as ReportType;
  const profileId = parseInt(req.body.profile_id);

  if (!reportType || !WRITER_MAP[reportType]) {
    res.status(400).json({
      success: false,
      error: `report_type required. Options: ${Object.keys(WRITER_MAP).join(', ')}`,
    });
    return;
  }

  if (!profileId) {
    res.status(400).json({ success: false, error: 'profile_id required (numeric Ads profile ID)' });
    return;
  }

  try {
    const content = req.file.buffer.toString('utf-8');
    const rawRows = parseCsv(content);

    if (rawRows.length === 0) {
      res.status(400).json({ success: false, error: 'File is empty or invalid format' });
      return;
    }

    // Normalize column names
    const rows = rawRows.map(normalizeRow);

    // Determine date range from data
    const dates = rows.map(r => r.date).filter(Boolean).sort();
    const startDate = dates[0] || new Date().toISOString().split('T')[0];
    const endDate = dates[dates.length - 1] || startDate;

    logger.info(`[AdsBackfill] ${reportType}: ${rows.length} rows, ${startDate}—${endDate}, profile ${profileId}`);

    const writer = WRITER_MAP[reportType];
    const written = await writer(profileId, startDate, endDate, rows);

    res.json({
      success: true,
      data: {
        report_type: reportType,
        rows_uploaded: rawRows.length,
        rows_written: written,
        date_range: { start: startDate, end: endDate },
      },
    });
  } catch (err: any) {
    logger.error(`[AdsBackfill] ${reportType} error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

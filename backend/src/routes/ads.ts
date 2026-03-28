import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/database';
import { getActiveProfiles, discoverProfiles, getAdsCredentials } from '../services/adsApi/client';
import { syncAdsForProfile, syncAllAdsProfiles } from '../services/adsApi/adsSync';
import { encryptCredential } from '../utils/crypto';
import { validateBody } from '../middleware/validate';
import logger from '../config/logger';

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

// POST /api/v1/ads/sync/trigger — Manual sync trigger
const triggerSchema = z.object({
  profile_id: z.number().int().positive().optional(),
  lookback_days: z.number().int().min(1).max(90).optional(),
});

router.post('/sync/trigger', validateBody(triggerSchema), async (req: Request, res: Response) => {
  const { profile_id, lookback_days } = req.body;

  try {
    if (profile_id) {
      // Sync specific profile
      const profileResult = await pool.query(
        'SELECT ap.credential_id, ap.profile_id, ap.country_code FROM ads_api_profiles ap WHERE ap.profile_id = $1 AND ap.is_active = true',
        [profile_id]
      );
      if (!profileResult.rows.length) {
        res.status(404).json({ success: false, error: 'Profile not found or inactive' });
        return;
      }

      const profile = profileResult.rows[0];
      // Run in background
      syncAdsForProfile(profile.credential_id, profile.profile_id, lookback_days || 14)
        .catch(err => logger.error(`[AdsRoute] Manual sync error: ${err.message}`));

      res.json({ success: true, message: `Ads sync started for profile ${profile.country_code} (${lookback_days || 14} days)` });
    } else {
      // Sync all
      syncAllAdsProfiles(lookback_days || 14)
        .catch(err => logger.error(`[AdsRoute] Manual sync-all error: ${err.message}`));

      res.json({ success: true, message: `Ads sync started for all active profiles (${lookback_days || 14} days)` });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

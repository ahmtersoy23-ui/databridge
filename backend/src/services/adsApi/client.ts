import axios, { AxiosInstance } from 'axios';
import { pool } from '../../config/database';
import logger from '../../config/logger';
import { decryptCredential } from '../../utils/crypto';
import type { AdsProfileResponse } from '../../types/ads';

const ADS_API_BASE = 'https://advertising-api.amazon.com';
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const TOKEN_TTL_MS = 55 * 60_000; // 55min (tokens expire in 60min)

// Token cache per credential
const tokenCache = new Map<number, { token: string; expiresAt: number }>();

// Circuit breaker
const CB_THRESHOLD = 3;
const CB_COOLDOWN_MS = 5 * 60_000;
let cbFailures = 0;
let cbOpenUntil = 0;

function checkCircuitBreaker(): void {
  if (cbFailures >= CB_THRESHOLD && Date.now() < cbOpenUntil) {
    const secsLeft = Math.ceil((cbOpenUntil - Date.now()) / 1000);
    throw new Error(`Ads API circuit breaker OPEN — ${secsLeft}s until retry (${cbFailures} consecutive failures)`);
  }
}

function recordSuccess(): void {
  if (cbFailures > 0) {
    logger.info(`[AdsAPI] Circuit breaker reset after recovery (was ${cbFailures} failures)`);
  }
  cbFailures = 0;
  cbOpenUntil = 0;
}

function recordFailure(): void {
  cbFailures++;
  if (cbFailures >= CB_THRESHOLD) {
    cbOpenUntil = Date.now() + CB_COOLDOWN_MS;
    logger.warn(`[AdsAPI] Circuit breaker OPEN after ${cbFailures} failures — cooldown ${CB_COOLDOWN_MS / 1000}s`);
  }
}

interface AdsCredentials {
  credential_id: number;
  client_id: string;
  client_secret: string;
  ads_refresh_token: string;
}

/**
 * Get Ads API credentials for a given credential_id.
 * Uses ADS_CLIENT_ID/ADS_CLIENT_SECRET from env (separate LWA app for Ads API)
 * and ads_refresh_token from sp_api_credentials.
 */
export async function getAdsCredentials(credentialId: number): Promise<AdsCredentials> {
  const adsClientId = process.env.ADS_CLIENT_ID;
  const adsClientSecret = process.env.ADS_CLIENT_SECRET;
  if (!adsClientId || !adsClientSecret) {
    throw new Error('ADS_CLIENT_ID and ADS_CLIENT_SECRET must be set in environment');
  }

  const result = await pool.query(
    `SELECT id, ads_refresh_token
     FROM sp_api_credentials
     WHERE id = $1 AND is_active = true`,
    [credentialId]
  );

  if (!result.rows.length) {
    throw new Error(`SP-API credential ${credentialId} not found or inactive`);
  }

  const row = result.rows[0];
  if (!row.ads_refresh_token) {
    throw new Error(`Credential ${credentialId} has no ads_refresh_token configured`);
  }

  return {
    credential_id: row.id,
    client_id: adsClientId,
    client_secret: adsClientSecret,
    ads_refresh_token: decryptCredential(row.ads_refresh_token),
  };
}

/**
 * Get LWA access token for Ads API (cached for 55min).
 */
async function getAdsToken(credentialId: number): Promise<string> {
  const cached = tokenCache.get(credentialId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  const creds = await getAdsCredentials(credentialId);

  const res = await axios.post(
    LWA_TOKEN_URL,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: creds.ads_refresh_token,
      client_id: creds.client_id,
      client_secret: creds.client_secret,
    }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15_000,
    }
  );

  const token: string = res.data.access_token;
  if (!token) throw new Error('LWA token response missing "access_token"');

  tokenCache.set(credentialId, {
    token,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });

  logger.info(`[AdsAPI] Token acquired for credential ${credentialId}`);
  return token;
}

/**
 * Create an axios instance configured for Amazon Ads API.
 * Profile ID is set per-request via `Amazon-Advertising-API-Scope` header.
 */
export async function getAdsClient(credentialId: number, profileId?: number): Promise<AxiosInstance> {
  checkCircuitBreaker();

  const token = await getAdsToken(credentialId);
  const creds = await getAdsCredentials(credentialId);

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Amazon-Advertising-API-ClientId': creds.client_id,
    'Content-Type': 'application/json',
  };

  if (profileId) {
    headers['Amazon-Advertising-API-Scope'] = String(profileId);
  }

  return axios.create({
    baseURL: ADS_API_BASE,
    headers,
    timeout: 60_000,
  });
}

/**
 * List all Ads API profiles for a credential.
 */
export async function listProfiles(credentialId: number): Promise<AdsProfileResponse[]> {
  try {
    const client = await getAdsClient(credentialId);
    const res = await client.get('/v2/profiles');
    recordSuccess();
    return res.data;
  } catch (err: any) {
    recordFailure();
    throw new Error(`Failed to list Ads profiles for credential ${credentialId}: ${err.message}`);
  }
}

/**
 * Discover and upsert Ads API profiles into DB.
 * Returns the number of profiles discovered.
 */
export async function discoverProfiles(credentialId: number): Promise<number> {
  const profiles = await listProfiles(credentialId);

  let count = 0;
  for (const p of profiles) {
    // Only SP (Sponsored Products) sellers — skip vendor-only or empty profiles
    if (!p.accountInfo?.id) continue;

    await pool.query(
      `INSERT INTO ads_api_profiles (credential_id, profile_id, country_code, marketplace_id, account_name, account_type)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (profile_id) DO UPDATE SET
         credential_id = EXCLUDED.credential_id,
         country_code = EXCLUDED.country_code,
         marketplace_id = EXCLUDED.marketplace_id,
         account_name = EXCLUDED.account_name,
         account_type = EXCLUDED.account_type,
         updated_at = NOW()`,
      [
        credentialId,
        p.profileId,
        p.countryCode,
        p.accountInfo.marketplaceStringId,
        p.accountInfo.name,
        p.accountInfo.type,
      ]
    );
    count++;
  }

  logger.info(`[AdsAPI] Discovered ${count} profiles for credential ${credentialId}`);
  return count;
}

/**
 * Get active Ads profiles from DB, optionally filtered by country.
 */
export async function getActiveProfiles(countryCode?: string): Promise<Array<{ id: number; credential_id: number; profile_id: number; country_code: string; account_name: string }>> {
  let query = `
    SELECT ap.id, ap.credential_id, ap.profile_id, ap.country_code, ap.account_name
    FROM ads_api_profiles ap
    JOIN sp_api_credentials cred ON ap.credential_id = cred.id AND cred.is_active = true
    WHERE ap.is_active = true
  `;
  const params: any[] = [];

  if (countryCode) {
    query += ' AND ap.country_code = $1';
    params.push(countryCode);
  }

  query += ' ORDER BY ap.country_code';
  const result = await pool.query(query, params);
  return result.rows;
}

export function clearTokenCache(): void {
  tokenCache.clear();
}

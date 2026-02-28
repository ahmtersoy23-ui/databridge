import { SellingPartner } from 'amazon-sp-api';
import { pool } from '../../config/database';
import logger from '../../config/logger';
import type { SpApiCredentials } from '../../types';

// Cache clients per credential ID to avoid recreating
const clientCache = new Map<string, { client: SellingPartner; expiresAt: number }>();
const CLIENT_CACHE_TTL = 30 * 60 * 1000; // 30 min

export async function getCredentialsById(credentialId: number): Promise<SpApiCredentials | null> {
  const result = await pool.query(
    'SELECT * FROM sp_api_credentials WHERE id = $1 AND is_active = true',
    [credentialId]
  );
  return result.rows[0] || null;
}

export async function getCredentialsByRegion(region: string): Promise<SpApiCredentials | null> {
  const result = await pool.query(
    'SELECT * FROM sp_api_credentials WHERE UPPER(region) = UPPER($1) AND is_active = true LIMIT 1',
    [region]
  );
  return result.rows[0] || null;
}

function buildClient(creds: SpApiCredentials): SellingPartner {
  return new SellingPartner({
    region: creds.region.toLowerCase() as 'na' | 'eu' | 'fe',
    refresh_token: creds.refresh_token,
    credentials: {
      SELLING_PARTNER_APP_CLIENT_ID: creds.client_id,
      SELLING_PARTNER_APP_CLIENT_SECRET: creds.client_secret,
    },
    options: {
      auto_request_tokens: true,
      auto_request_throttled: true,
    },
  });
}

export async function getSpApiClient(credentialId: number): Promise<SellingPartner> {
  const cacheKey = `cred:${credentialId}`;
  const cached = clientCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.client;
  }

  const creds = await getCredentialsById(credentialId);
  if (!creds) {
    throw new Error(`No active SP-API credentials for id: ${credentialId}`);
  }

  const client = buildClient(creds);
  clientCache.set(cacheKey, { client, expiresAt: Date.now() + CLIENT_CACHE_TTL });
  logger.info(`[SP-API] Client created for credential id: ${credentialId} (${creds.account_name || creds.region})`);

  return client;
}

// Fallback: region-based lookup (backward compat for manual triggers without credential_id)
export async function getSpApiClientByRegion(region: string): Promise<SellingPartner> {
  const cacheKey = `region:${region}`;
  const cached = clientCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.client;
  }

  const creds = await getCredentialsByRegion(region);
  if (!creds) {
    throw new Error(`No active SP-API credentials for region: ${region}`);
  }

  const client = buildClient(creds);
  clientCache.set(cacheKey, { client, expiresAt: Date.now() + CLIENT_CACHE_TTL });
  logger.info(`[SP-API] Client created for region: ${region} (fallback)`);

  return client;
}

export function clearClientCache(): void {
  clientCache.clear();
}

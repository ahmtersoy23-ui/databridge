import { SellingPartner } from 'amazon-sp-api';
import { pool } from '../../config/database';
import logger from '../../config/logger';
import type { SpApiCredentials } from '../../types';

// Cache clients per region to avoid recreating
const clientCache = new Map<string, { client: SellingPartner; expiresAt: number }>();
const CLIENT_CACHE_TTL = 30 * 60 * 1000; // 30 min

export async function getCredentials(region: string): Promise<SpApiCredentials | null> {
  const result = await pool.query(
    'SELECT * FROM sp_api_credentials WHERE UPPER(region) = UPPER($1) AND is_active = true LIMIT 1',
    [region]
  );
  return result.rows[0] || null;
}

export async function getSpApiClient(region: string): Promise<SellingPartner> {
  const cached = clientCache.get(region);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.client;
  }

  const creds = await getCredentials(region);
  if (!creds) {
    throw new Error(`No active SP-API credentials for region: ${region}`);
  }

  const client = new SellingPartner({
    region: region as 'na' | 'eu' | 'fe',
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

  clientCache.set(region, { client, expiresAt: Date.now() + CLIENT_CACHE_TTL });
  logger.info(`[SP-API] Client created for region: ${region}`);

  return client;
}

export function clearClientCache(): void {
  clientCache.clear();
}

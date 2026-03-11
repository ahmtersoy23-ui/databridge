import axios from 'axios';
import { pool } from '../../config/database';
import logger from '../../config/logger';

interface WayfairCredentials {
  client_id: string;
  client_secret: string;
  use_sandbox: boolean;
  supplier_id: number | null;
}

// In-memory token cache (12h lifetime)
let cachedToken: string | null = null;
let tokenExpiry = 0;

export function clearWayfairTokenCache(): void {
  cachedToken = null;
  tokenExpiry = 0;
}

export async function getCredentials(): Promise<WayfairCredentials> {
  const result = await pool.query(
    'SELECT client_id, client_secret, use_sandbox, supplier_id FROM wayfair_credentials WHERE id = 1'
  );
  if (!result.rows.length) {
    throw new Error('Wayfair credentials not configured. Add them in Settings.');
  }
  return result.rows[0];
}

// Returns the CastleGate GraphQL endpoint URL
export function getApiBase(useSandbox: boolean): string {
  return useSandbox
    ? 'https://api.wayfair.io/sandbox/v1/supplier-order-api/graphql'
    : 'https://api.wayfair.io/v1/supplier-order-api/graphql';
}

// Returns the Dropship GraphQL endpoint URL (different host from CastleGate)
export function getDropshipApiBase(useSandbox: boolean): string {
  return useSandbox
    ? 'https://sandbox.api.wayfair.com/v1/graphql'
    : 'https://api.wayfair.com/v1/graphql';
}

async function getToken(): Promise<{ token: string; graphqlUrl: string }> {
  if (cachedToken && Date.now() < tokenExpiry - 60_000) {
    const creds = await getCredentials();
    return { token: cachedToken, graphqlUrl: getApiBase(creds.use_sandbox) };
  }

  const creds = await getCredentials();
  const graphqlUrl = getApiBase(creds.use_sandbox);

  let res;
  try {
    res = await axios.post(
      'https://sso.auth.wayfair.com/oauth/token',
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: creds.client_id,
        client_secret: creds.client_secret,
        audience: 'https://api.wayfair.com/',
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15_000,
      }
    );
  } catch (err: any) {
    if (err.response?.status === 401) {
      throw new Error('Wayfair auth failed: invalid client_id or client_secret');
    }
    throw new Error(`Wayfair token request failed: ${err.message}`);
  }

  const token: string = res.data.access_token;
  if (!token) throw new Error('Wayfair token response missing "access_token" field');

  const expiresIn: number = res.data.expires_in || 43200; // default 12h
  tokenExpiry = Date.now() + expiresIn * 1000;
  cachedToken = token;

  logger.info(`[Wayfair] Token acquired, expires in ${expiresIn}s (sandbox=${creds.use_sandbox})`);
  return { token, graphqlUrl };
}

export async function graphqlQuery<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
  endpointOverride?: string
): Promise<T> {
  const { token, graphqlUrl } = await getToken();

  const res = await axios.post(
    endpointOverride ?? graphqlUrl,
    { query, variables },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 60_000,
    }
  );

  if (res.data.errors?.length) {
    const msg = res.data.errors.map((e: any) => e.message).join('; ');
    throw new Error(`Wayfair GraphQL error: ${msg}`);
  }

  return res.data.data as T;
}

/**
 * Get the Wayfair supplier ID.
 * 1. Check DB (wayfair_credentials.supplier_id)
 * 2. Try auto-discover via getApplicationByClientId API
 * 3. Store discovered ID back to DB for future use
 */
export async function getSupplierId(): Promise<number> {
  const creds = await getCredentials();

  if (creds.supplier_id) return creds.supplier_id;

  // Try auto-discover
  const result = await graphqlQuery<{
    getApplicationByClientId: { suppliers: { id: number; name: string }[] } | null
  }>(`{ getApplicationByClientId(clientId: "${creds.client_id}") { suppliers { id name } } }`);

  const supplierId = result.getApplicationByClientId?.suppliers?.[0]?.id;
  if (!supplierId) {
    throw new Error(
      'Wayfair supplier ID could not be auto-discovered. ' +
      'Enter it manually in Settings > Wayfair CastleGate API > Supplier ID.'
    );
  }

  // Persist for future calls
  await pool.query('UPDATE wayfair_credentials SET supplier_id = $1 WHERE id = 1', [supplierId]);
  logger.info(`[Wayfair] Auto-discovered supplier ID: ${supplierId}`);
  return supplierId;
}

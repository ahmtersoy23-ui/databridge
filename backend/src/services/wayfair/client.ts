import axios from 'axios';
import { pool } from '../../config/database';
import logger from '../../config/logger';

interface WayfairCredentials {
  client_id: string;
  client_secret: string;
  use_sandbox: boolean;
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
    'SELECT client_id, client_secret, use_sandbox FROM wayfair_credentials WHERE id = 1'
  );
  if (!result.rows.length) {
    throw new Error('Wayfair credentials not configured. Add them in Settings.');
  }
  return result.rows[0];
}

export function getApiBase(useSandbox: boolean): string {
  return useSandbox
    ? 'https://sandbox.api.wayfair.com'
    : 'https://api.wayfair.com';
}

async function getToken(): Promise<{ token: string; apiBase: string }> {
  if (cachedToken && Date.now() < tokenExpiry - 60_000) {
    const creds = await getCredentials();
    return { token: cachedToken, apiBase: getApiBase(creds.use_sandbox) };
  }

  const creds = await getCredentials();
  const apiBase = getApiBase(creds.use_sandbox);

  let res;
  try {
    res = await axios.post(
      'https://auth.api.wayfair.com/v1/oauth/token',
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
  return { token, apiBase };
}

export async function graphqlQuery<T = unknown>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const { token, apiBase } = await getToken();

  const res = await axios.post(
    `${apiBase}/v1/graphql`,
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

import axios from 'axios';
import { pool } from '../../config/database';
import logger from '../../config/logger';
import { decryptCredential } from '../../utils/crypto';

// -- Account type ----------------------------------------------------------

export interface WayfairAccount {
  id: number;
  label: string;       // 'cg' | 'mdn'
  client_id: string;
  client_secret: string; // decrypted
  use_sandbox: boolean;
  supplier_id: number | null;
  channel: string;     // 'wfs' | 'wfm'
  warehouse: string;   // 'WFS' | 'WFM'
  is_active: boolean;
}

// -- Per-account token cache -----------------------------------------------

const tokenCache = new Map<number, { token: string; expiry: number }>();

// -- Per-account circuit breaker -------------------------------------------

const CB_THRESHOLD = 3;
const CB_COOLDOWN_MS = 5 * 60_000;
const circuitBreakers = new Map<number, { failures: number; openUntil: number }>();

function checkCircuitBreaker(accountId: number): void {
  const cb = circuitBreakers.get(accountId);
  if (cb && cb.failures >= CB_THRESHOLD && Date.now() < cb.openUntil) {
    const secsLeft = Math.ceil((cb.openUntil - Date.now()) / 1000);
    throw new Error(`Wayfair circuit breaker OPEN (account ${accountId}) — ${secsLeft}s until retry`);
  }
}

function recordSuccess(accountId: number): void {
  const cb = circuitBreakers.get(accountId);
  if (cb && cb.failures > 0) {
    logger.info(`[Wayfair] Circuit breaker reset for account ${accountId}`);
  }
  circuitBreakers.set(accountId, { failures: 0, openUntil: 0 });
}

function recordFailure(accountId: number): void {
  const cb = circuitBreakers.get(accountId) || { failures: 0, openUntil: 0 };
  cb.failures++;
  if (cb.failures >= CB_THRESHOLD) {
    cb.openUntil = Date.now() + CB_COOLDOWN_MS;
    logger.warn(`[Wayfair] Circuit breaker OPEN for account ${accountId} after ${cb.failures} failures`);
  }
  circuitBreakers.set(accountId, cb);
}

// -- Public API ------------------------------------------------------------

export function clearWayfairTokenCache(accountId?: number): void {
  if (accountId !== undefined) {
    tokenCache.delete(accountId);
  } else {
    tokenCache.clear();
  }
}

export async function getActiveAccounts(): Promise<WayfairAccount[]> {
  const result = await pool.query(
    `SELECT id, label, client_id, client_secret, use_sandbox, supplier_id, channel, warehouse, is_active
     FROM wayfair_credentials WHERE is_active = true ORDER BY id`
  );
  return result.rows.map((row: any) => ({
    ...row,
    client_secret: decryptCredential(row.client_secret),
  }));
}

export async function getAccountById(accountId: number): Promise<WayfairAccount> {
  const result = await pool.query(
    `SELECT id, label, client_id, client_secret, use_sandbox, supplier_id, channel, warehouse, is_active
     FROM wayfair_credentials WHERE id = $1`,
    [accountId]
  );
  if (!result.rows.length) throw new Error(`Wayfair account ${accountId} not found`);
  const row = result.rows[0];
  return { ...row, client_secret: decryptCredential(row.client_secret) };
}

export async function getAccountByLabel(label: string): Promise<WayfairAccount> {
  const result = await pool.query(
    `SELECT id, label, client_id, client_secret, use_sandbox, supplier_id, channel, warehouse, is_active
     FROM wayfair_credentials WHERE label = $1`,
    [label]
  );
  if (!result.rows.length) throw new Error(`Wayfair account '${label}' not found`);
  const row = result.rows[0];
  return { ...row, client_secret: decryptCredential(row.client_secret) };
}

/** @deprecated — use getActiveAccounts / getAccountById instead */
export async function getCredentials(): Promise<WayfairAccount> {
  return getAccountById(1);
}

// Returns the CastleGate GraphQL endpoint URL
export function getApiBase(useSandbox: boolean): string {
  return useSandbox
    ? 'https://api.wayfair.io/sandbox/v1/supplier-order-api/graphql'
    : 'https://api.wayfair.io/v1/supplier-order-api/graphql';
}

// Returns the Dropship GraphQL endpoint URL
export function getDropshipApiBase(useSandbox: boolean): string {
  return useSandbox
    ? 'https://sandbox.api.wayfair.com/v1/graphql'
    : 'https://api.wayfair.com/v1/graphql';
}

async function getToken(account: WayfairAccount): Promise<{ token: string; graphqlUrl: string }> {
  const cached = tokenCache.get(account.id);
  if (cached && Date.now() < cached.expiry - 60_000) {
    return { token: cached.token, graphqlUrl: getApiBase(account.use_sandbox) };
  }

  const graphqlUrl = getApiBase(account.use_sandbox);

  let res;
  try {
    res = await axios.post(
      'https://sso.auth.wayfair.com/oauth/token',
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: account.client_id,
        client_secret: account.client_secret,
        audience: 'https://api.wayfair.com/',
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15_000,
      }
    );
  } catch (err: any) {
    if (err.response?.status === 401) {
      throw new Error(`Wayfair auth failed for account '${account.label}': invalid credentials`);
    }
    throw new Error(`Wayfair token request failed (${account.label}): ${err.message}`);
  }

  const token: string = res.data.access_token;
  if (!token) throw new Error('Wayfair token response missing "access_token" field');

  const expiresIn: number = res.data.expires_in || 43200;
  tokenCache.set(account.id, { token, expiry: Date.now() + expiresIn * 1000 });

  logger.info(`[Wayfair] Token acquired for '${account.label}', expires in ${expiresIn}s`);
  return { token, graphqlUrl };
}

export async function graphqlQuery<T = unknown>(
  account: WayfairAccount,
  query: string,
  variables?: Record<string, unknown>,
  endpointOverride?: string
): Promise<T> {
  checkCircuitBreaker(account.id);

  try {
    const { token, graphqlUrl } = await getToken(account);

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

    recordSuccess(account.id);
    return res.data.data as T;
  } catch (err) {
    recordFailure(account.id);
    throw err;
  }
}

export async function getSupplierId(account: WayfairAccount): Promise<number> {
  if (account.supplier_id) return account.supplier_id;

  const result = await graphqlQuery<{
    getApplicationByClientId: { suppliers: { id: number; name: string }[] } | null
  }>(
    account,
    `query GetApp($clientId: String!) { getApplicationByClientId(clientId: $clientId) { suppliers { id name } } }`,
    { clientId: account.client_id }
  );

  const supplierId = result.getApplicationByClientId?.suppliers?.[0]?.id;
  if (!supplierId) {
    throw new Error(
      `Wayfair supplier ID could not be auto-discovered for '${account.label}'. Enter it manually in Settings.`
    );
  }

  await pool.query('UPDATE wayfair_credentials SET supplier_id = $1 WHERE id = $2', [supplierId, account.id]);
  logger.info(`[Wayfair] Auto-discovered supplier ID for '${account.label}': ${supplierId}`);
  return supplierId;
}

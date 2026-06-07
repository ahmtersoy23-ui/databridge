import axios, { AxiosRequestConfig } from 'axios';
import { createHmac } from 'crypto';
import { pool } from '../../config/database';
import logger from '../../config/logger';
import { decryptCredential } from '../../utils/crypto';
import { errMessage } from '../../utils/errors';

// -- Account type ----------------------------------------------------------

export interface KauflandAccount {
  id: number;
  label: string;
  client_key: string;
  secret_key: string;   // decrypted
  storefront: string;   // e.g. 'de_DE'
  channel: string;      // sales_data channel code, e.g. 'kaufland_de'
  is_active: boolean;
}

// -- Circuit breaker -------------------------------------------------------

const CB_THRESHOLD = 3;
const CB_COOLDOWN_MS = 5 * 60_000;
const circuitBreakers = new Map<number, { failures: number; openUntil: number }>();

function checkCircuitBreaker(accountId: number): void {
  const cb = circuitBreakers.get(accountId);
  if (cb && cb.failures >= CB_THRESHOLD && Date.now() < cb.openUntil) {
    const secsLeft = Math.ceil((cb.openUntil - Date.now()) / 1000);
    throw new Error(`Kaufland circuit breaker OPEN (account ${accountId}) — ${secsLeft}s until retry`);
  }
}

function recordSuccess(accountId: number): void {
  const cb = circuitBreakers.get(accountId);
  if (cb && cb.failures > 0) {
    logger.info(`[Kaufland] Circuit breaker reset for account ${accountId}`);
  }
  circuitBreakers.set(accountId, { failures: 0, openUntil: 0 });
}

function recordFailure(accountId: number): void {
  const cb = circuitBreakers.get(accountId) || { failures: 0, openUntil: 0 };
  cb.failures++;
  if (cb.failures >= CB_THRESHOLD) {
    cb.openUntil = Date.now() + CB_COOLDOWN_MS;
    logger.warn(`[Kaufland] Circuit breaker OPEN for account ${accountId} after ${cb.failures} failures`);
  }
  circuitBreakers.set(accountId, cb);
}

// -- Storefront helpers ----------------------------------------------------

/**
 * Kaufland API endpoints expect storefront as 2-letter COUNTRY code (lowercase):
 *   de_DE → 'de', cs_CZ → 'cz', sk_SK → 'sk', pl_PL → 'pl', de_AT → 'at'.
 * Note: locale prefix is the LANGUAGE (cs/de), not the country — we need the
 * suffix. Fallback to prefix only when there's no underscore.
 */
export function storefrontCode(account: KauflandAccount): string {
  const parts = account.storefront.split('_');
  return (parts[1] ?? parts[0]).toLowerCase();
}

// -- Account helpers -------------------------------------------------------

export async function getActiveAccounts(): Promise<KauflandAccount[]> {
  const result = await pool.query(
    `SELECT id, label, client_key, secret_key, storefront, channel, is_active
     FROM kaufland_credentials WHERE is_active = true ORDER BY id`
  );
  return result.rows.map((row: any) => ({
    ...row,
    secret_key: decryptCredential(row.secret_key),
  }));
}

export async function getAccountById(accountId: number): Promise<KauflandAccount> {
  const result = await pool.query(
    `SELECT id, label, client_key, secret_key, storefront, channel, is_active
     FROM kaufland_credentials WHERE id = $1`,
    [accountId]
  );
  if (!result.rows.length) throw new Error(`Kaufland account ${accountId} not found`);
  const row = result.rows[0];
  return { ...row, secret_key: decryptCredential(row.secret_key) };
}

// -- API base + signing ----------------------------------------------------

const BASE_URL = 'https://sellerapi.kaufland.com/v2';

/**
 * HMAC-SHA256 signature per Kaufland spec.
 * Plaintext = METHOD + "\n" + FULL_URL + "\n" + BODY + "\n" + TIMESTAMP
 * Output: hex digest.
 */
function signRequest(
  method: string,
  url: string,
  body: string,
  timestamp: number,
  secret: string
): string {
  const plaintext = `${method.toUpperCase()}\n${url}\n${body}\n${timestamp}`;
  return createHmac('sha256', secret).update(plaintext).digest('hex');
}

interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  skipCircuitBreaker?: boolean;
  timeout?: number;
}

export async function kauflandRequest<T = unknown>(
  account: KauflandAccount,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  opts: RequestOptions = {}
): Promise<T> {
  if (!opts.skipCircuitBreaker) checkCircuitBreaker(account.id);

  const query = opts.query ?? {};
  const queryStr = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  const fullUrl = `${BASE_URL}${path}${queryStr ? '?' + queryStr : ''}`;

  const bodyStr = opts.body ? JSON.stringify(opts.body) : '';
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signRequest(method, fullUrl, bodyStr, timestamp, account.secret_key);

  const config: AxiosRequestConfig = {
    method,
    url: fullUrl,
    headers: {
      'Shop-Client-Key': account.client_key,
      'Shop-Timestamp': String(timestamp),
      'Shop-Signature': signature,
      Accept: 'application/json',
      'User-Agent': 'IWA_DataBridge/1.0',
      ...(bodyStr ? { 'Content-Type': 'application/json' } : {}),
    },
    timeout: opts.timeout ?? 30_000,
    ...(bodyStr ? { data: bodyStr } : {}),
  };

  try {
    const res = await axios.request<T>(config);
    if (!opts.skipCircuitBreaker) recordSuccess(account.id);
    return res.data;
  } catch (err: unknown) {
    if (!opts.skipCircuitBreaker) recordFailure(account.id);
    const status = axios.isAxiosError(err) ? err.response?.status : undefined;
    const data = axios.isAxiosError(err) ? err.response?.data : undefined;
    const msg = data ? `${status} ${JSON.stringify(data).slice(0, 300)}` : errMessage(err);
    throw new Error(`Kaufland ${method} ${path} failed: ${msg}`);
  }
}

// -- Connection test -------------------------------------------------------

/**
 * Probe the API by fetching one order (limit=1). Returns the response payload
 * so settings UI can show "Connection OK — N orders" style hints.
 */
export async function testConnection(account: KauflandAccount): Promise<{ ok: true; orderCount: number }> {
  const res = await kauflandRequest<{ data?: unknown[]; pagination?: { total?: number } }>(
    account,
    'GET',
    '/orders',
    { query: { limit: 1, storefront: storefrontCode(account) }, skipCircuitBreaker: true }
  );
  const total = res.pagination?.total ?? (Array.isArray(res.data) ? res.data.length : 0);
  return { ok: true, orderCount: total };
}

import axios, { AxiosRequestConfig } from 'axios';
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import logger from '../../config/logger';
import { decryptCredential } from '../../utils/crypto';
import { parseRetryAfterHeader } from '../../utils/retry';

// -- Account type ----------------------------------------------------------

export interface WalmartAccount {
  id: number;
  label: string;
  client_id: string;
  client_secret: string; // decrypted
  use_sandbox: boolean;
  is_active: boolean;
}

// -- Token cache (15-min TTL — Walmart's short-lived token) ----------------

const tokenCache = new Map<number, { token: string; expiry: number }>();

// -- Circuit breaker (same shape as Wayfair) -------------------------------

const CB_THRESHOLD = 3;
const CB_COOLDOWN_MS = 5 * 60_000;
const circuitBreakers = new Map<number, { failures: number; openUntil: number }>();

function checkCircuitBreaker(accountId: number): void {
  const cb = circuitBreakers.get(accountId);
  if (cb && cb.failures >= CB_THRESHOLD && Date.now() < cb.openUntil) {
    const secsLeft = Math.ceil((cb.openUntil - Date.now()) / 1000);
    throw new Error(`Walmart circuit breaker OPEN (account ${accountId}) — ${secsLeft}s until retry`);
  }
}

function recordSuccess(accountId: number): void {
  const cb = circuitBreakers.get(accountId);
  if (cb && cb.failures > 0) {
    logger.info(`[Walmart] Circuit breaker reset for account ${accountId}`);
  }
  circuitBreakers.set(accountId, { failures: 0, openUntil: 0 });
}

function recordFailure(accountId: number): void {
  const cb = circuitBreakers.get(accountId) || { failures: 0, openUntil: 0 };
  cb.failures++;
  if (cb.failures >= CB_THRESHOLD) {
    cb.openUntil = Date.now() + CB_COOLDOWN_MS;
    logger.warn(`[Walmart] Circuit breaker OPEN for account ${accountId} after ${cb.failures} failures`);
  }
  circuitBreakers.set(accountId, cb);
}

// -- Account helpers -------------------------------------------------------

export function clearWalmartTokenCache(accountId?: number): void {
  if (accountId !== undefined) {
    tokenCache.delete(accountId);
  } else {
    tokenCache.clear();
  }
}

export async function getActiveAccounts(): Promise<WalmartAccount[]> {
  const result = await pool.query(
    `SELECT id, label, client_id, client_secret, use_sandbox, is_active
     FROM walmart_credentials WHERE is_active = true ORDER BY id`
  );
  return result.rows.map((row: any) => ({
    ...row,
    client_secret: decryptCredential(row.client_secret),
  }));
}

export async function getAccountById(accountId: number): Promise<WalmartAccount> {
  const result = await pool.query(
    `SELECT id, label, client_id, client_secret, use_sandbox, is_active
     FROM walmart_credentials WHERE id = $1`,
    [accountId]
  );
  if (!result.rows.length) throw new Error(`Walmart account ${accountId} not found`);
  const row = result.rows[0];
  return { ...row, client_secret: decryptCredential(row.client_secret) };
}

// -- API base + token endpoint --------------------------------------------

export function getApiBase(useSandbox: boolean): string {
  return useSandbox
    ? 'https://sandbox.walmartapis.com'
    : 'https://marketplace.walmartapis.com';
}

// Token endpoint is same for sandbox/prod (per developer.walmart.com docs)
function tokenUrl(useSandbox: boolean): string {
  return `${getApiBase(useSandbox)}/v3/token`;
}

// -- Token fetch (Basic Auth + form-urlencoded) ----------------------------

async function getToken(account: WalmartAccount): Promise<string> {
  const cached = tokenCache.get(account.id);
  // Refresh 60s before expiry to avoid mid-request stale tokens
  if (cached && Date.now() < cached.expiry - 60_000) {
    return cached.token;
  }

  const basicAuth = Buffer
    .from(`${account.client_id}:${account.client_secret}`)
    .toString('base64');

  let res;
  try {
    res = await axios.post(
      tokenUrl(account.use_sandbox),
      new URLSearchParams({ grant_type: 'client_credentials' }),
      {
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'WM_SVC.NAME': 'Walmart Marketplace',
          'WM_QOS.CORRELATION_ID': randomUUID(),
        },
        timeout: 15_000,
      }
    );
  } catch (err: any) {
    if (err.response?.status === 401 || err.response?.status === 400) {
      throw new Error(`Walmart auth failed for '${account.label}': invalid credentials`);
    }
    throw new Error(`Walmart token request failed (${account.label}): ${err.message}`);
  }

  const token: string = res.data.access_token;
  if (!token) throw new Error('Walmart token response missing "access_token" field');

  const expiresIn: number = res.data.expires_in || 900; // 15 minutes default
  tokenCache.set(account.id, { token, expiry: Date.now() + expiresIn * 1000 });

  logger.info(`[Walmart] Token acquired for '${account.label}', expires in ${expiresIn}s`);
  return token;
}

// -- Generic GET wrapper with WM_SEC.ACCESS_TOKEN header -------------------

export interface WalmartRequestOptions {
  params?: Record<string, string | number | boolean | undefined>;
  /** Pass a fully-formed cursor query string (starts with '?'). When set, `params` is ignored. */
  cursor?: string;
}

export async function walmartGet<T = unknown>(
  account: WalmartAccount,
  path: string,
  opts: WalmartRequestOptions = {}
): Promise<T> {
  checkCircuitBreaker(account.id);

  try {
    const token = await getToken(account);
    const base = getApiBase(account.use_sandbox);

    let url: string;
    let config: AxiosRequestConfig;

    if (opts.cursor) {
      // nextCursor is a full query string (already URL-encoded by Walmart).
      // We append it directly to keep param order/encoding identical.
      const sep = opts.cursor.startsWith('?') ? '' : '?';
      url = `${base}${path}${sep}${opts.cursor}`;
      config = {};
    } else {
      url = `${base}${path}`;
      // Strip undefined values so axios doesn't send blank query params
      const cleanParams: Record<string, string | number | boolean> = {};
      for (const [k, v] of Object.entries(opts.params ?? {})) {
        if (v !== undefined && v !== null && v !== '') cleanParams[k] = v;
      }
      config = { params: cleanParams };
    }

    const res = await axios.get<T>(url, {
      ...config,
      headers: {
        'WM_SEC.ACCESS_TOKEN': token,
        'WM_QOS.CORRELATION_ID': randomUUID(),
        'WM_SVC.NAME': 'Walmart Marketplace',
        Accept: 'application/json',
      },
      timeout: 60_000,
    });

    recordSuccess(account.id);
    return res.data;
  } catch (err: any) {
    recordFailure(account.id);

    // 429 — surface replenish time so callers can back off
    if (err.response?.status === 429) {
      const replenishAt = err.response.headers?.['x-next-replenishment-time'];
      // Walmart `x-next-replenishment-time` HTTP-date veya saniye olabilir; ikisini de parseRetryAfterHeader yakalar.
      const sec = parseRetryAfterHeader(replenishAt);
      const e: any = new Error(`Walmart rate limit (429). Next replenish: ${replenishAt ?? 'unknown'}`);
      e.status = 429;
      if (sec !== null) e.retryAfterMs = sec * 1000;
      throw e;
    }

    throw err;
  }
}

import axios from 'axios';
import { pool } from '../../config/database';
import logger from '../../config/logger';
import { decryptCredential } from '../../utils/crypto';
import { parseRetryAfterHeader } from '../../utils/retry';
import { errMessage } from '../../utils/errors';

// -- Account type ----------------------------------------------------------

export interface BolAccount {
  id: number;
  label: string;                  // 'pera' | 'onebv'
  client_id: string;
  client_secret: string;          // decrypted
  channel: string;                // sales_data.channel ('bol_pera' | 'bol_onebv')
  use_sandbox: boolean;
  is_active: boolean;
}

// -- Token cache (Bol TTL is 299s, refresh proactively) --------------------

const tokenCache = new Map<number, { token: string; expiry: number }>();

// -- Circuit breaker per account -------------------------------------------

const CB_THRESHOLD = 3;
const CB_COOLDOWN_MS = 5 * 60_000;
const circuitBreakers = new Map<number, { failures: number; openUntil: number }>();

function checkCircuitBreaker(accountId: number): void {
  const cb = circuitBreakers.get(accountId);
  if (cb && cb.failures >= CB_THRESHOLD && Date.now() < cb.openUntil) {
    const secsLeft = Math.ceil((cb.openUntil - Date.now()) / 1000);
    throw new Error(`Bol circuit breaker OPEN (account ${accountId}) — ${secsLeft}s until retry`);
  }
}

function recordSuccess(accountId: number): void {
  const cb = circuitBreakers.get(accountId);
  if (cb && cb.failures > 0) {
    logger.info(`[Bol] Circuit breaker reset for account ${accountId}`);
  }
  circuitBreakers.set(accountId, { failures: 0, openUntil: 0 });
}

function recordFailure(accountId: number): void {
  const cb = circuitBreakers.get(accountId) || { failures: 0, openUntil: 0 };
  cb.failures++;
  if (cb.failures >= CB_THRESHOLD) {
    cb.openUntil = Date.now() + CB_COOLDOWN_MS;
    logger.warn(`[Bol] Circuit breaker OPEN for account ${accountId} after ${cb.failures} failures`);
  }
  circuitBreakers.set(accountId, cb);
}

// -- Account helpers -------------------------------------------------------

export function clearBolTokenCache(accountId?: number): void {
  if (accountId !== undefined) {
    tokenCache.delete(accountId);
  } else {
    tokenCache.clear();
  }
}

const ACCOUNT_SELECT = `
  SELECT id, label, client_id, client_secret, channel, use_sandbox, is_active
  FROM bol_credentials
`;

export async function getActiveAccounts(): Promise<BolAccount[]> {
  const result = await pool.query(`${ACCOUNT_SELECT} WHERE is_active = true ORDER BY id`);
  return result.rows.map((row: any) => ({
    ...row,
    client_secret: decryptCredential(row.client_secret),
  }));
}

export async function getAccountById(accountId: number): Promise<BolAccount> {
  const result = await pool.query(`${ACCOUNT_SELECT} WHERE id = $1`, [accountId]);
  if (!result.rows.length) throw new Error(`Bol account ${accountId} not found`);
  const row = result.rows[0];
  return { ...row, client_secret: decryptCredential(row.client_secret) };
}

export async function getAccountByLabel(label: string): Promise<BolAccount> {
  const result = await pool.query(`${ACCOUNT_SELECT} WHERE label = $1`, [label]);
  if (!result.rows.length) throw new Error(`Bol account '${label}' not found`);
  const row = result.rows[0];
  return { ...row, client_secret: decryptCredential(row.client_secret) };
}

// -- API base + token endpoint --------------------------------------------

// Bol's API host is the same for sandbox/prod; sandbox uses different endpoints
// (we don't expose sandbox separately — token endpoint is identical anyway)
const TOKEN_URL = 'https://login.bol.com/token';
const API_BASE = 'https://api.bol.com/retailer';

// v10 vendor media type — without this, all requests return 406.
const V10_MEDIA_TYPE = 'application/vnd.retailer.v10+json';

// -- Token fetch (Basic Auth + form-urlencoded) ----------------------------

async function getToken(account: BolAccount): Promise<string> {
  const cached = tokenCache.get(account.id);
  // Bol token TTL = 299s; refresh 30s before expiry to avoid mid-request stale tokens
  if (cached && Date.now() < cached.expiry - 30_000) {
    return cached.token;
  }

  const basicAuth = Buffer
    .from(`${account.client_id}:${account.client_secret}`)
    .toString('base64');

  let res;
  try {
    res = await axios.post(
      TOKEN_URL,
      new URLSearchParams({ grant_type: 'client_credentials' }),
      {
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        timeout: 15_000,
      }
    );
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && (err.response?.status === 401 || err.response?.status === 400)) {
      throw new Error(`Bol auth failed for '${account.label}': invalid credentials`);
    }
    throw new Error(`Bol token request failed (${account.label}): ${errMessage(err)}`);
  }

  const token: string = res.data.access_token;
  if (!token) throw new Error('Bol token response missing "access_token" field');

  const expiresIn: number = res.data.expires_in || 299;
  tokenCache.set(account.id, { token, expiry: Date.now() + expiresIn * 1000 });

  logger.info(`[Bol] Token acquired for '${account.label}', expires in ${expiresIn}s`);
  return token;
}

// -- Generic GET wrapper with Bearer + vendor media type -------------------

export interface BolRequestOptions {
  params?: Record<string, string | number | boolean | undefined>;
  /** Skip circuit breaker — for detail loops where individual failures shouldn't tank the batch */
  skipCircuitBreaker?: boolean;
}

export async function bolGet<T = unknown>(
  account: BolAccount,
  path: string,
  opts: BolRequestOptions = {}
): Promise<T> {
  if (!opts.skipCircuitBreaker) checkCircuitBreaker(account.id);

  try {
    const token = await getToken(account);

    const cleanParams: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(opts.params ?? {})) {
      if (v !== undefined && v !== null && v !== '') cleanParams[k] = v;
    }

    const res = await axios.get<T>(`${API_BASE}${path}`, {
      params: cleanParams,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: V10_MEDIA_TYPE,
      },
      timeout: 60_000,
    });

    if (!opts.skipCircuitBreaker) recordSuccess(account.id);
    return res.data;
  } catch (err: unknown) {
    if (!opts.skipCircuitBreaker) recordFailure(account.id);

    if (axios.isAxiosError(err)) {
      if (err.response?.status === 404) {
        // 404 — empty collection (Bol uses 404 for "no orders in this filter")
        return ({ orders: [] } as unknown) as T;
      }

      if (err.response?.status === 429) {
        const retryAfter = err.response.headers?.['retry-after'];
        const sec = parseRetryAfterHeader(retryAfter);
        const e: any = new Error(`Bol rate limit (429). Retry-After: ${retryAfter ?? 'unknown'}`);
        e.status = 429;
        if (sec !== null) e.retryAfterMs = sec * 1000;
        throw e;
      }
    }

    throw err;
  }
}

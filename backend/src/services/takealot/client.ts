import axios from 'axios';
import { pool } from '../../config/database';
import logger from '../../config/logger';
import { decryptCredential } from '../../utils/crypto';

// -- Account type (single-account but multi-account ready) -----------------

export interface TakealotAccount {
  id: number;
  label: string;
  api_key: string;     // decrypted
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
    throw new Error(`Takealot circuit breaker OPEN (account ${accountId}) — ${secsLeft}s until retry`);
  }
}

function recordSuccess(accountId: number): void {
  const cb = circuitBreakers.get(accountId);
  if (cb && cb.failures > 0) logger.info(`[Takealot] CB reset for account ${accountId}`);
  circuitBreakers.set(accountId, { failures: 0, openUntil: 0 });
}

function recordFailure(accountId: number): void {
  const cb = circuitBreakers.get(accountId) || { failures: 0, openUntil: 0 };
  cb.failures++;
  if (cb.failures >= CB_THRESHOLD) {
    cb.openUntil = Date.now() + CB_COOLDOWN_MS;
    logger.warn(`[Takealot] CB OPEN for account ${accountId} after ${cb.failures} failures`);
  }
  circuitBreakers.set(accountId, cb);
}

// -- Account helpers -------------------------------------------------------

const ACCOUNT_SELECT = `
  SELECT id, label, api_key, is_active FROM takealot_credentials
`;

export async function getActiveAccounts(): Promise<TakealotAccount[]> {
  const result = await pool.query(`${ACCOUNT_SELECT} WHERE is_active = true ORDER BY id`);
  return result.rows.map((row: any) => ({
    ...row,
    api_key: decryptCredential(row.api_key),
  }));
}

export async function getAccountById(accountId: number): Promise<TakealotAccount> {
  const result = await pool.query(`${ACCOUNT_SELECT} WHERE id = $1`, [accountId]);
  if (!result.rows.length) throw new Error(`Takealot account ${accountId} not found`);
  const row = result.rows[0];
  return { ...row, api_key: decryptCredential(row.api_key) };
}

// -- API base --------------------------------------------------------------

const API_BASE = 'https://seller-api.takealot.com';

// -- Generic GET wrapper ---------------------------------------------------

export interface TakealotRequestOptions {
  params?: Record<string, string | number | boolean | undefined>;
  skipCircuitBreaker?: boolean;
}

export async function takealotGet<T = unknown>(
  account: TakealotAccount,
  path: string,
  opts: TakealotRequestOptions = {},
): Promise<T> {
  if (!opts.skipCircuitBreaker) checkCircuitBreaker(account.id);

  try {
    const cleanParams: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(opts.params ?? {})) {
      if (v !== undefined && v !== null && v !== '') cleanParams[k] = v;
    }

    const res = await axios.get<T>(`${API_BASE}${path}`, {
      params: cleanParams,
      headers: {
        // Takealot doc doesn't standardize — most common is "Key <api_key>".
        // If that fails (401), env var TAKEALOT_AUTH_SCHEME=Bearer can override.
        Authorization: `${process.env.TAKEALOT_AUTH_SCHEME || 'Key'} ${account.api_key}`,
        Accept: 'application/json',
      },
      timeout: 60_000,
    });

    if (!opts.skipCircuitBreaker) recordSuccess(account.id);
    return res.data;
  } catch (err: any) {
    if (!opts.skipCircuitBreaker) recordFailure(account.id);

    if (err.response?.status === 429) {
      const retryAfter = err.response.headers?.['retry-after'];
      throw new Error(`Takealot rate limit (429). Retry-After: ${retryAfter ?? 'unknown'}`);
    }

    throw err;
  }
}

import logger from '../config/logger';
import { errMessage } from './errors';

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  label?: string;
  isRetryable?: (err: any) => boolean;
}

export function getHttpStatus(err: any): number | undefined {
  return err?.response?.status ?? err?.status ?? err?.statusCode;
}

const RETRY_AFTER_CAP_MS = 60_000;

/**
 * Error object'inde `retryAfterMs` property'si varsa onu (cap'le birlikte) döndürür.
 * Yoksa undefined — caller exponential backoff'a düşmeli.
 *
 * Client'lar 429 fırlatırken bu property'i ataması beklenir:
 *   const e: any = new Error(...); e.status = 429; e.retryAfterMs = X; throw e;
 */
export function getRetryAfterMs(err: any): number | undefined {
  const raw = err?.retryAfterMs;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return undefined;
  return Math.min(raw, RETRY_AFTER_CAP_MS);
}

/**
 * "Retry-After" HTTP header'ını parse eder.
 * Format: saniye (int) ya da HTTP-date.
 * Geçersiz/eksik için null.
 */
export function parseRetryAfterHeader(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const num = Number(raw);
  if (Number.isFinite(num) && num >= 0) {
    // Cok buyuk sayi = relatif saniye DEGIL, mutlak zaman damgasi. Walmart
    // `x-next-replenishment-time` epoch-MS verir (or. 1781189744550); bazi API'ler
    // epoch-saniye. Relatif saniye sanilirsa astronomik backoff -> Node timeout
    // overflow -> 1ms -> backoff yok -> pes pese 429 -> circuit breaker acilir.
    if (num >= 1e12) return Math.max(0, Math.ceil((num - Date.now()) / 1000)); // epoch-ms
    if (num >= 1e9) return Math.max(0, Math.ceil(num - Date.now() / 1000));    // epoch-saniye
    return Math.floor(num);                                                    // gercek relatif saniye
  }
  const epoch = Date.parse(raw);
  if (Number.isFinite(epoch)) {
    const sec = Math.ceil((epoch - Date.now()) / 1000);
    return sec > 0 ? sec : 0;
  }
  return null;
}

/**
 * Default sınıflandırıcı.
 * - HTTP 429 ve 5xx → transient (retry)
 * - HTTP 4xx (429 hariç) → permanent (retry yok)
 * - Bilinen network hata code/pattern → transient
 * - Bilinmeyen → transient (geri uyumluluk; eski callerlar generic Error fırlatıyor)
 */
export function isTransientError(err: any): boolean {
  const status = getHttpStatus(err);
  if (status === 429) return true;
  if (status && status >= 500 && status < 600) return true;
  if (status && status >= 400 && status < 500) return false;

  const code = (err?.code || '').toString();
  if (/^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|EHOSTUNREACH|ENETUNREACH)$/.test(code)) {
    return true;
  }
  const msg = (err?.message || '').toString();
  if (/socket hang up|network error|fetch failed|aborted|timeout/i.test(msg)) {
    return true;
  }

  return true;
}

/**
 * Exponential backoff ile retry.
 * Default delay: 5s, 20s, 45s (baseDelay * attempt^2)
 *
 * Permanent error (4xx auth/validation) algılanırsa hemen fırlatır,
 * boşa retry + rate-limit baskısı oluşturmaz.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 5_000,
    label = 'operation',
    isRetryable = isTransientError,
  } = opts;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const status = getHttpStatus(err);
      const statusInfo = status ? ` [HTTP ${status}]` : '';
      const transient = isRetryable(err);

      if (!transient) {
        logger.warn(`[Retry] ${label} permanent error${statusInfo}, not retrying: ${errMessage(err)}`);
        throw err;
      }
      if (attempt === maxRetries) {
        logger.error(`[Retry] ${label} failed after ${maxRetries} attempts${statusInfo}: ${errMessage(err)}`);
        throw err;
      }
      const retryAfter = getRetryAfterMs(err);
      const delay = retryAfter ?? baseDelayMs * attempt * attempt;
      const source = retryAfter ? 'Retry-After' : 'exponential';
      logger.warn(`[Retry] ${label} attempt ${attempt}/${maxRetries}${statusInfo} failed: ${errMessage(err)}. Retrying in ${delay / 1000}s (${source})...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error('Retry exhausted');
}

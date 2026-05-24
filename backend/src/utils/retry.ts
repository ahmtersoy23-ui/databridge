import logger from '../config/logger';

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  label?: string;
  isRetryable?: (err: any) => boolean;
}

export function getHttpStatus(err: any): number | undefined {
  return err?.response?.status ?? err?.status ?? err?.statusCode;
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
    } catch (err: any) {
      const status = getHttpStatus(err);
      const statusInfo = status ? ` [HTTP ${status}]` : '';
      const transient = isRetryable(err);

      if (!transient) {
        logger.warn(`[Retry] ${label} permanent error${statusInfo}, not retrying: ${err.message}`);
        throw err;
      }
      if (attempt === maxRetries) {
        logger.error(`[Retry] ${label} failed after ${maxRetries} attempts${statusInfo}: ${err.message}`);
        throw err;
      }
      const delay = baseDelayMs * attempt * attempt;
      logger.warn(`[Retry] ${label} attempt ${attempt}/${maxRetries}${statusInfo} failed: ${err.message}. Retrying in ${delay / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error('Retry exhausted');
}

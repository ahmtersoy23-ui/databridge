import logger from '../config/logger';

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  label?: string;
}

/**
 * Retry a function with exponential backoff.
 * Delays: 5s, 20s, 45s (baseDelay * attempt^2)
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 5_000, label = 'operation' } = opts;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (attempt === maxRetries) {
        logger.error(`[Retry] ${label} failed after ${maxRetries} attempts: ${err.message}`);
        throw err;
      }
      const delay = baseDelayMs * attempt * attempt; // exponential
      logger.warn(`[Retry] ${label} attempt ${attempt}/${maxRetries} failed: ${err.message}. Retrying in ${delay / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // unreachable, but TS needs it
  throw new Error('Retry exhausted');
}

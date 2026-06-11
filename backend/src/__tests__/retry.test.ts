import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { withRetry, isTransientError, parseRetryAfterHeader, getRetryAfterMs } from '../utils/retry';

describe('isTransientError', () => {
  it('classifies HTTP 429 as transient', () => {
    expect(isTransientError({ response: { status: 429 } })).toBe(true);
    expect(isTransientError({ status: 429 })).toBe(true);
  });

  it('classifies HTTP 5xx as transient', () => {
    expect(isTransientError({ response: { status: 500 } })).toBe(true);
    expect(isTransientError({ response: { status: 502 } })).toBe(true);
    expect(isTransientError({ response: { status: 503 } })).toBe(true);
    expect(isTransientError({ response: { status: 504 } })).toBe(true);
  });

  it('classifies HTTP 4xx (non-429) as permanent', () => {
    expect(isTransientError({ response: { status: 400 } })).toBe(false);
    expect(isTransientError({ response: { status: 401 } })).toBe(false);
    expect(isTransientError({ response: { status: 403 } })).toBe(false);
    expect(isTransientError({ response: { status: 404 } })).toBe(false);
    expect(isTransientError({ status: 401 })).toBe(false);
  });

  it('classifies node network errors as transient', () => {
    expect(isTransientError({ code: 'ECONNRESET' })).toBe(true);
    expect(isTransientError({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isTransientError({ code: 'ENOTFOUND' })).toBe(true);
    expect(isTransientError({ code: 'ECONNREFUSED' })).toBe(true);
  });

  it('classifies fetch failure message as transient', () => {
    expect(isTransientError({ message: 'fetch failed' })).toBe(true);
    expect(isTransientError({ message: 'socket hang up' })).toBe(true);
    expect(isTransientError({ message: 'request timeout' })).toBe(true);
  });

  it('defaults unknown errors to transient (backward compat)', () => {
    expect(isTransientError(new Error('something went wrong'))).toBe(true);
    expect(isTransientError({ message: 'unexpected' })).toBe(true);
  });
});

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { label: 'test' });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on transient failure then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockResolvedValue('ok');
    const result = await withRetry(fn, { label: 'test', baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after max retries exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    await expect(
      withRetry(fn, { maxRetries: 2, baseDelayMs: 1, label: 'test' }),
    ).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on HTTP 401 (permanent)', async () => {
    const fn = vi.fn().mockRejectedValue({ response: { status: 401 }, message: 'Unauthorized' });
    await expect(
      withRetry(fn, { maxRetries: 3, baseDelayMs: 1, label: 'auth-test' }),
    ).rejects.toMatchObject({ response: { status: 401 } });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on HTTP 400 / 403 / 404', async () => {
    for (const status of [400, 403, 404]) {
      const fn = vi.fn().mockRejectedValue({ response: { status }, message: `HTTP ${status}` });
      await expect(
        withRetry(fn, { maxRetries: 3, baseDelayMs: 1, label: `test-${status}` }),
      ).rejects.toMatchObject({ response: { status } });
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });

  it('DOES retry on HTTP 429 (rate limit)', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ response: { status: 429 }, message: 'rate limited' })
      .mockResolvedValue('ok');
    const result = await withRetry(fn, { baseDelayMs: 1, label: 'rate-test' });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('DOES retry on HTTP 503', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ response: { status: 503 }, message: 'unavailable' })
      .mockRejectedValueOnce({ response: { status: 503 }, message: 'unavailable' })
      .mockResolvedValue('ok');
    const result = await withRetry(fn, { baseDelayMs: 1, label: '503-test' });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('respects custom isRetryable override', async () => {
    const fn = vi.fn().mockRejectedValue({ response: { status: 401 }, message: 'auth' });
    // Custom: 401'i transient say (örn. credential rotation senaryosu)
    await expect(
      withRetry(fn, {
        maxRetries: 2,
        baseDelayMs: 1,
        label: 'custom',
        isRetryable: () => true,
      }),
    ).rejects.toMatchObject({ response: { status: 401 } });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('honors err.retryAfterMs over exponential backoff', async () => {
    const start = Date.now();
    const fn = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('429'), { status: 429, retryAfterMs: 50 }))
      .mockResolvedValue('ok');
    const result = await withRetry(fn, { baseDelayMs: 10_000, label: 'rate', maxRetries: 2 });
    const elapsed = Date.now() - start;
    expect(result).toBe('ok');
    // 50ms retryAfter kullanıldı, 10s exponential değil
    expect(elapsed).toBeLessThan(1000);
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });
});

describe('parseRetryAfterHeader', () => {
  it('parses integer seconds', () => {
    expect(parseRetryAfterHeader('30')).toBe(30);
    expect(parseRetryAfterHeader('0')).toBe(0);
    expect(parseRetryAfterHeader('120')).toBe(120);
  });

  it('parses HTTP-date (future)', () => {
    const future = new Date(Date.now() + 45_000).toUTCString();
    const sec = parseRetryAfterHeader(future);
    expect(sec).toBeGreaterThanOrEqual(44);
    expect(sec).toBeLessThanOrEqual(46);
  });

  it('epoch-ms timestamp (Walmart x-next-replenishment-time) → relatif saniye', () => {
    const epochMs = String(Date.now() + 60_000); // 60s sonrasi, ms
    const sec = parseRetryAfterHeader(epochMs);
    expect(sec).toBeGreaterThanOrEqual(58);
    expect(sec).toBeLessThanOrEqual(62);
  });

  it('epoch-saniye timestamp → relatif saniye', () => {
    const epochSec = String(Math.floor(Date.now() / 1000) + 90); // 90s sonrasi, saniye
    const sec = parseRetryAfterHeader(epochSec);
    expect(sec).toBeGreaterThanOrEqual(88);
    expect(sec).toBeLessThanOrEqual(92);
  });

  it('gecmis epoch-ms → 0 (negatif backoff yok)', () => {
    expect(parseRetryAfterHeader(String(Date.now() - 60_000))).toBe(0);
  });

  it('returns 0 for past HTTP-date', () => {
    const past = new Date(Date.now() - 10_000).toUTCString();
    expect(parseRetryAfterHeader(past)).toBe(0);
  });

  it('returns null for missing/invalid', () => {
    expect(parseRetryAfterHeader(undefined)).toBeNull();
    expect(parseRetryAfterHeader('')).toBeNull();
    expect(parseRetryAfterHeader('garbage')).toBeNull();
  });
});

describe('getRetryAfterMs', () => {
  it('caps at 60_000 ms', () => {
    expect(getRetryAfterMs({ retryAfterMs: 5_000 })).toBe(5_000);
    expect(getRetryAfterMs({ retryAfterMs: 120_000 })).toBe(60_000);
  });

  it('returns undefined for missing/invalid', () => {
    expect(getRetryAfterMs({})).toBeUndefined();
    expect(getRetryAfterMs({ retryAfterMs: 0 })).toBeUndefined();
    expect(getRetryAfterMs({ retryAfterMs: -100 })).toBeUndefined();
    expect(getRetryAfterMs({ retryAfterMs: 'abc' })).toBeUndefined();
  });
});

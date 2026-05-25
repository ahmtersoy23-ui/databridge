import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getCronJitterMs, getCronJitterMaxMs } from '../utils/jitter';

describe('getCronJitterMaxMs', () => {
  const originalEnv = process.env.CRON_JITTER_MAX_SEC;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.CRON_JITTER_MAX_SEC;
    else process.env.CRON_JITTER_MAX_SEC = originalEnv;
  });

  it('default 30000 ms (30 sec)', () => {
    delete process.env.CRON_JITTER_MAX_SEC;
    expect(getCronJitterMaxMs()).toBe(30_000);
  });

  it('honors env override', () => {
    process.env.CRON_JITTER_MAX_SEC = '60';
    expect(getCronJitterMaxMs()).toBe(60_000);
  });

  it('allows 0 for tests/dev (jitter disabled)', () => {
    process.env.CRON_JITTER_MAX_SEC = '0';
    expect(getCronJitterMaxMs()).toBe(0);
  });

  it('rejects invalid (>600, negative, NaN) → default', () => {
    process.env.CRON_JITTER_MAX_SEC = '700';
    expect(getCronJitterMaxMs()).toBe(30_000);

    process.env.CRON_JITTER_MAX_SEC = '-5';
    expect(getCronJitterMaxMs()).toBe(30_000);

    process.env.CRON_JITTER_MAX_SEC = 'abc';
    expect(getCronJitterMaxMs()).toBe(30_000);
  });
});

describe('getCronJitterMs', () => {
  beforeEach(() => {
    process.env.CRON_JITTER_MAX_SEC = '30';
  });

  afterEach(() => {
    delete process.env.CRON_JITTER_MAX_SEC;
    vi.restoreAllMocks();
  });

  it('returns 0 when max is 0', () => {
    process.env.CRON_JITTER_MAX_SEC = '0';
    expect(getCronJitterMs()).toBe(0);
  });

  it('returns value in [0, max*1000)', () => {
    for (let i = 0; i < 200; i++) {
      const v = getCronJitterMs();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(30_000);
    }
  });

  it('uses Math.random — deterministic with mock', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(getCronJitterMs()).toBe(15_000);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(getCronJitterMs()).toBe(0);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// #5 regresyon kilidi: scheduler wrapper'ları catch bloğunda hatayı YUTMAMALI —
// throw ederek withSyncLog'a propagate etmeli ki sync_log 'failed' işaretlensin +
// 🔴 Slack alarmı çıksın. Eskiden `catch → return 0/void` ile yutuyorlardı →
// gerçek API/DB hatası 'success, 0 rows' gibi görünüyordu.

vi.mock('../config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Gerçek pg pool oluşmasın (modül grafiği config/database import ediyor).
vi.mock('../config/database', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  sharedPool: { query: vi.fn(), connect: vi.fn() },
}));

// withRetry pass-through: runWayfairSync syncWayfair'i withRetry ile sarıyor;
// pass-through olmazsa reject testinde 3× exponential backoff (~65s) beklerdi.
vi.mock('../utils/retry', () => ({
  withRetry: (fn: () => Promise<unknown>) => fn(),
  getHttpStatus: () => undefined,
  getRetryAfterMs: () => undefined,
  parseRetryAfterHeader: () => null,
  isTransientError: () => true,
}));

const mockSyncWalmart = vi.fn();
const mockSyncWayfair = vi.fn();
vi.mock('../services/sync/walmartOrdersSync', () => ({
  syncWalmartOrders: (...a: unknown[]) => mockSyncWalmart(...a),
}));
vi.mock('../services/sync/wayfairSync', () => ({
  syncWayfair: (...a: unknown[]) => mockSyncWayfair(...a),
}));

import { runWalmartOrdersSync, runWayfairSync } from '../services/sync/scheduler';

describe('scheduler wrapper hata propagasyonu (#5 kilidi)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runWalmartOrdersSync (count flavor): başarıda satır sayısı döner', async () => {
    mockSyncWalmart.mockResolvedValue(42);
    await expect(runWalmartOrdersSync()).resolves.toBe(42);
  });

  it('runWalmartOrdersSync: sync throw ederse REJECT eder (yutmaz)', async () => {
    mockSyncWalmart.mockRejectedValue(new Error('Walmart API 503'));
    await expect(runWalmartOrdersSync()).rejects.toThrow('Walmart API 503');
  });

  it('runWayfairSync (void flavor): başarıda resolve eder', async () => {
    mockSyncWayfair.mockResolvedValue(undefined);
    await expect(runWayfairSync()).resolves.toBeUndefined();
  });

  it('runWayfairSync: sync throw ederse REJECT eder (yutmaz)', async () => {
    mockSyncWayfair.mockRejectedValue(new Error('Wayfair down'));
    await expect(runWayfairSync()).rejects.toThrow('Wayfair down');
  });
});

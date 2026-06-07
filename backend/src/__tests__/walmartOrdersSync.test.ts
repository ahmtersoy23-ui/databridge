import { describe, it, expect, vi, beforeEach } from 'vitest';

// Walmart order sync — kritik invariant: %20 safety threshold (sessiz veri kaybi onleme).
// API bos/eksik pencere donerse, mevcut veriye gore %80+ dususte YAZMA + Slack alert.

vi.mock('../config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockPoolQuery = vi.fn();
const mockSharedQuery = vi.fn();
vi.mock('../config/database', () => ({
  pool: { query: (...a: any[]) => mockPoolQuery(...a) },
  sharedPool: { query: (...a: any[]) => mockSharedQuery(...a) },
}));

const mockNotify = vi.fn().mockResolvedValue(undefined);
vi.mock('../utils/notify', () => ({ notify: (...a: any[]) => mockNotify(...a) }));

const mockFetchOrders = vi.fn();
vi.mock('../services/walmart/orders', () => ({
  fetchOrders: (...a: any[]) => mockFetchOrders(...a),
}));
vi.mock('../services/walmart/client', () => ({ getActiveAccounts: vi.fn() }));
vi.mock('../services/sync/walmartSalesDataWriter', () => ({
  writeWalmartSalesData: vi.fn().mockResolvedValue(0),
}));

import { syncWalmartOrdersForAccount } from '../services/sync/walmartOrdersSync';

const account = { id: 1, label: 'pera' } as any;
const makeLine = (i: number) => ({ sku: `SKU${i}`, order_date_local: '2026-06-01' });

beforeEach(() => {
  vi.clearAllMocks();
  // Default: COUNT query high, mapping/insert empty
  mockPoolQuery.mockImplementation((sql: string) => {
    if (/COUNT\(\*\)/.test(sql)) return Promise.resolve({ rows: [{ cnt: '100' }] });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  mockSharedQuery.mockResolvedValue({ rows: [] });
});

describe('syncWalmartOrdersForAccount — safety threshold', () => {
  it('bos pencere → 0 doner, alarm yok', async () => {
    mockFetchOrders.mockResolvedValue([]);
    const n = await syncWalmartOrdersForAccount(account, 30);
    expect(n).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('esigin altinda dusus → YAZMA + Slack alert', async () => {
    // 2 satir cekildi, DB'de 100 var → 2 < 100*0.2=20 → skip
    mockFetchOrders.mockResolvedValue([makeLine(1), makeLine(2)]);
    const n = await syncWalmartOrdersForAccount(account, 30);
    expect(n).toBe(0);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify.mock.calls[0][0]).toMatch(/SKIPPED/);
  });

  it('saglikli hacim → alarm yok, yazma yoluna devam', async () => {
    // 50 satir, DB'de 100 → 50 >= 20 → devam
    mockFetchOrders.mockResolvedValue(Array.from({ length: 50 }, (_, i) => makeLine(i)));
    await syncWalmartOrdersForAccount(account, 30);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('DB bos/az veri (<=10) → threshold devre disi, alarm yok', async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (/COUNT\(\*\)/.test(sql)) return Promise.resolve({ rows: [{ cnt: '5' }] });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    mockFetchOrders.mockResolvedValue([makeLine(1)]);
    await syncWalmartOrdersForAccount(account, 30);
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

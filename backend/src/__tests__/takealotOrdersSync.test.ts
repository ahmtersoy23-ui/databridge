import { describe, it, expect, vi, beforeEach } from 'vitest';

// Takealot order sync — kritik invariant: orders icin %20 safety threshold.
// Inventory snapshot her zaman yazilir (threshold yok); sadece orders korunur.

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
const mockFetchOffers = vi.fn();
vi.mock('../services/takealot/orders', () => ({
  fetchOrders: (...a: any[]) => mockFetchOrders(...a),
}));
vi.mock('../services/takealot/inventory', () => ({
  fetchOffers: (...a: any[]) => mockFetchOffers(...a),
}));
vi.mock('../services/takealot/client', () => ({ getActiveAccounts: vi.fn() }));
vi.mock('../services/sync/takealotSalesDataWriter', () => ({
  writeTakealotSalesData: vi.fn().mockResolvedValue(0),
}));

import { syncTakealotForAccount } from '../services/sync/takealotOrdersSync';

const account = { id: 1, label: 'za' } as any;
const makeLine = (i: number) => ({ sku: `SKU${i}`, order_date_local: '2026-06-01' });

beforeEach(() => {
  vi.clearAllMocks();
  mockPoolQuery.mockImplementation((sql: string) => {
    if (/COUNT\(\*\)/.test(sql)) return Promise.resolve({ rows: [{ cnt: '100' }] });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  mockSharedQuery.mockResolvedValue({ rows: [] });
  mockFetchOffers.mockResolvedValue([]); // inventory bos
});

describe('syncTakealotForAccount — orders safety threshold', () => {
  it('siparis yok → alarm yok (inventory yine de islenir)', async () => {
    mockFetchOrders.mockResolvedValue([]);
    const n = await syncTakealotForAccount(account, 30);
    expect(n).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('esigin altinda dusus → orders YAZILMAZ + Slack alert', async () => {
    mockFetchOrders.mockResolvedValue([makeLine(1), makeLine(2)]);
    await syncTakealotForAccount(account, 30);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify.mock.calls[0][0]).toMatch(/SKIPPED/);
  });

  it('saglikli hacim → alarm yok', async () => {
    mockFetchOrders.mockResolvedValue(Array.from({ length: 50 }, (_, i) => makeLine(i)));
    await syncTakealotForAccount(account, 30);
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

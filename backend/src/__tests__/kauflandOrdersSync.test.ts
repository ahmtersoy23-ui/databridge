import { describe, it, expect, vi, beforeEach } from 'vitest';

// Kaufland order sync — kritik invariant: orders icin %20 safety threshold.
// Inventory (units) snapshot her zaman yazilir; sadece orders korunur.

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
const mockFetchUnits = vi.fn();
vi.mock('../services/kaufland/orders', () => ({
  fetchOrdersWithUnits: (...a: any[]) => mockFetchOrders(...a),
}));
vi.mock('../services/kaufland/inventory', () => ({
  fetchAllUnits: (...a: any[]) => mockFetchUnits(...a),
}));
vi.mock('../services/kaufland/client', () => ({ getActiveAccounts: vi.fn() }));
vi.mock('../services/sync/kauflandSalesDataWriter', () => ({
  writeKauflandSalesData: vi.fn().mockResolvedValue(0),
}));

import { syncKauflandForAccount } from '../services/sync/kauflandOrdersSync';

const account = { id: 1, label: 'de' } as any;
const makeLine = (i: number) => ({
  ean: null,
  offer_sku: `SKU${i}`,
  product_id_unit: null,
  order_date_local: '2026-06-01',
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPoolQuery.mockImplementation((sql: string) => {
    if (/COUNT\(\*\)/.test(sql)) return Promise.resolve({ rows: [{ cnt: '100' }] });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  mockSharedQuery.mockResolvedValue({ rows: [] });
  mockFetchUnits.mockResolvedValue([]); // inventory bos
});

describe('syncKauflandForAccount — orders safety threshold', () => {
  it('siparis yok → alarm yok (inventory yine de islenir)', async () => {
    mockFetchOrders.mockResolvedValue([]);
    const n = await syncKauflandForAccount(account, 30);
    expect(n).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('esigin altinda dusus → orders YAZILMAZ + Slack alert', async () => {
    mockFetchOrders.mockResolvedValue([makeLine(1), makeLine(2)]);
    await syncKauflandForAccount(account, 30);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify.mock.calls[0][0]).toMatch(/SKIPPED/);
  });

  it('saglikli hacim → alarm yok', async () => {
    mockFetchOrders.mockResolvedValue(Array.from({ length: 50 }, (_, i) => makeLine(i)));
    await syncKauflandForAccount(account, 30);
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

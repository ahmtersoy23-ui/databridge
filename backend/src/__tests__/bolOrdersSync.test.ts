import { describe, it, expect, vi, beforeEach } from 'vitest';

// Bol.com order sync — kritik invariant: %20 safety threshold (sessiz veri kaybi onleme).

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

const mockFetchShipments = vi.fn();
const mockFetchOrders = vi.fn();
vi.mock('../services/bol/orders', () => ({
  fetchShipments: (...a: any[]) => mockFetchShipments(...a),
  fetchOrders: (...a: any[]) => mockFetchOrders(...a),
}));
vi.mock('../services/bol/client', () => ({ getActiveAccounts: vi.fn() }));
vi.mock('../services/sync/bolSalesDataWriter', () => ({
  writeBolSalesData: vi.fn().mockResolvedValue(0),
}));

import { syncBolOrdersForAccount } from '../services/sync/bolOrdersSync';

const account = { id: 1, label: 'pera' } as any;
const makeLine = (i: number) => ({ sku: `SKU${i}`, order_date_local: '2026-06-01' });

beforeEach(() => {
  vi.clearAllMocks();
  mockPoolQuery.mockImplementation((sql: string) => {
    if (/COUNT\(\*\)/.test(sql)) return Promise.resolve({ rows: [{ cnt: '100' }] });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  mockSharedQuery.mockResolvedValue({ rows: [] });
});

describe('syncBolOrdersForAccount — safety threshold (shipments modu)', () => {
  it('bos pencere → 0 doner, alarm yok', async () => {
    mockFetchShipments.mockResolvedValue([]);
    const n = await syncBolOrdersForAccount(account);
    expect(n).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('esigin altinda dusus → YAZMA + Slack alert', async () => {
    mockFetchShipments.mockResolvedValue([makeLine(1), makeLine(2)]);
    const n = await syncBolOrdersForAccount(account);
    expect(n).toBe(0);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify.mock.calls[0][0]).toMatch(/SKIPPED/);
  });

  it('saglikli hacim → alarm yok', async () => {
    mockFetchShipments.mockResolvedValue(Array.from({ length: 50 }, (_, i) => makeLine(i)));
    await syncBolOrdersForAccount(account);
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

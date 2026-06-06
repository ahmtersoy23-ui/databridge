import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockPoolQuery = vi.fn();
vi.mock('../config/database', () => ({
  pool: { query: (...args: any[]) => mockPoolQuery(...args) },
}));

const mockGetSpApiClient = vi.fn();
vi.mock('../services/spApi/client', () => ({
  getSpApiClient: (...args: any[]) => mockGetSpApiClient(...args),
}));

import { fetchCanceledOrdersSince, fetchOrderStatusesByIds } from '../services/spApi/orderStatus';

beforeEach(() => {
  vi.clearAllMocks();
  // İki aktif NA hesabı
  mockPoolQuery.mockResolvedValue({ rows: [{ id: 1 }, { id: 5 }] });
});

describe('fetchCanceledOrdersSince', () => {
  it('iki hesabı tarar ve NextToken ile sayfalar, iptalleri birleştirir', async () => {
    const cred1 = {
      callAPI: vi.fn()
        .mockResolvedValueOnce({ Orders: [{ AmazonOrderId: 'A' }], NextToken: 'tok' })
        .mockResolvedValueOnce({ Orders: [{ AmazonOrderId: 'B' }] }),
    };
    const cred5 = {
      callAPI: vi.fn().mockResolvedValueOnce({ Orders: [{ AmazonOrderId: 'C' }] }),
    };
    mockGetSpApiClient.mockImplementation((id: number) => (id === 1 ? cred1 : cred5));

    const canceled = await fetchCanceledOrdersSince(new Date('2026-06-06T00:00:00Z'));

    expect([...canceled].sort()).toEqual(['A', 'B', 'C']);
    expect(cred1.callAPI).toHaveBeenCalledTimes(2); // sayfalama
    // İlk çağrı temel parametreleri içerir, ikinci çağrı NextToken
    expect(cred1.callAPI.mock.calls[0][0].query).toMatchObject({ OrderStatuses: ['Canceled'] });
    expect(cred1.callAPI.mock.calls[1][0].query).toMatchObject({ NextToken: 'tok' });
  });

  it('hiç iptal yoksa boş küme döner', async () => {
    const client = { callAPI: vi.fn().mockResolvedValue({ Orders: [] }) };
    mockGetSpApiClient.mockResolvedValue(client);
    const canceled = await fetchCanceledOrdersSince(new Date('2026-06-06T00:00:00Z'));
    expect(canceled.size).toBe(0);
  });
});

describe('fetchOrderStatusesByIds', () => {
  it('yanlış hesapta hata alınca sonraki hesabı dener', async () => {
    const cred1 = {
      callAPI: vi.fn().mockImplementation(({ path }: any) => {
        if (path.orderId === 'X') return Promise.resolve({ OrderStatus: 'Canceled' });
        return Promise.reject(new Error('NotFound')); // Y bu hesapta yok
      }),
    };
    const cred5 = {
      callAPI: vi.fn().mockImplementation(({ path }: any) => {
        if (path.orderId === 'Y') return Promise.resolve({ OrderStatus: 'Shipped' });
        return Promise.reject(new Error('NotFound'));
      }),
    };
    mockGetSpApiClient.mockImplementation((id: number) => (id === 1 ? cred1 : cred5));

    const statuses = await fetchOrderStatusesByIds(['X', 'Y']);

    expect(statuses).toEqual({ X: 'Canceled', Y: 'Shipped' });
  });

  it('hiçbir hesapta bulunamayan sipariş Unknown olur', async () => {
    const client = { callAPI: vi.fn().mockRejectedValue(new Error('NotFound')) };
    mockGetSpApiClient.mockResolvedValue(client);
    const statuses = await fetchOrderStatusesByIds(['ZZZ']);
    expect(statuses).toEqual({ ZZZ: 'Unknown' });
  });
});

import { graphqlQuery, getDropshipApiBase, type WayfairAccount } from './client';
import logger from '../../config/logger';

export interface WayfairCGProduct {
  partNumber: string;
  quantity: number;
  price: number;
  totalCost?: number;
}

export interface WayfairCGOrder {
  id: string;
  poNumber: string;
  poDate: string;
  supplierId: number;
  products: WayfairCGProduct[];
}

const CG_QUERY = `
  query getCastleGatePurchaseOrders(
    $limit: Int32
    $hasResponse: Boolean
    $sortOrder: SortOrder
    $fromDate: IsoDateTime
  ) {
    getCastleGatePurchaseOrders(
      limit: $limit
      hasResponse: $hasResponse
      sortOrder: $sortOrder
      fromDate: $fromDate
    ) {
      id
      poNumber
      poDate
      supplierId
      products {
        partNumber
        quantity
        price
        totalCost
      }
    }
  }
`;

interface CGResponse {
  getCastleGatePurchaseOrders: WayfairCGOrder[];
}

const PAGE_LIMIT = 100;

/**
 * Fetch all CastleGate POs from fromDate onwards using date-cursor pagination.
 * Each batch returns up to PAGE_LIMIT orders sorted ASC. We advance fromDate
 * to the last order's poDate and repeat until fewer than PAGE_LIMIT are returned.
 */
export async function fetchWayfairPurchaseOrders(
  account: WayfairAccount,
  fromDate?: string,
  hasResponse?: boolean,
): Promise<WayfairCGOrder[]> {
  const endpoint = getDropshipApiBase(account.use_sandbox);
  const all: WayfairCGOrder[] = [];
  let cursor = fromDate || null;

  while (true) {
    let result: CGResponse;
    try {
      result = await graphqlQuery<CGResponse>(
        account,
        CG_QUERY,
        {
          limit: PAGE_LIMIT,
          hasResponse: hasResponse ?? null,
          sortOrder: 'ASC',
          fromDate: cursor,
        },
        endpoint
      );
    } catch (err: any) {
      logger.info(`[Wayfair CG][${account.label}] ${err.message || ''}`);
      break;
    }

    const orders = result.getCastleGatePurchaseOrders || [];
    if (orders.length === 0) break;

    all.push(...orders);

    if (orders.length < PAGE_LIMIT) break; // last page
    cursor = orders[orders.length - 1].poDate;
  }

  logger.info(`[Wayfair CG][${account.label}] ${all.length} CastleGate orders fetched (fromDate=${fromDate || 'all'})`);
  return all;
}

import { graphqlQuery, getDropshipApiBase, type WayfairAccount } from './client';
import logger from '../../config/logger';

export interface WayfairDropshipProduct {
  partNumber: string;
  quantity: number;
  price: number;
}

export interface WayfairDropshipOrder {
  poNumber: string;
  poDate: string;
  supplierId: number;
  products: WayfairDropshipProduct[];
}

const DS_QUERY = `
  query getDropshipPurchaseOrders(
    $limit: Int32
    $hasResponse: Boolean
    $sortOrder: SortOrder
    $fromDate: IsoDateTime
  ) {
    getDropshipPurchaseOrders(
      limit: $limit
      hasResponse: $hasResponse
      sortOrder: $sortOrder
      fromDate: $fromDate
    ) {
      poNumber
      poDate
      supplierId
      products {
        partNumber
        quantity
        price
      }
    }
  }
`;

interface DSResponse {
  getDropshipPurchaseOrders: WayfairDropshipOrder[];
}

const PAGE_LIMIT = 100;

/**
 * Fetch all Dropship POs from fromDate onwards using date-cursor pagination.
 */
export async function fetchDropshipOrders(
  account: WayfairAccount,
  fromDate?: string,
  hasResponse?: boolean,
): Promise<WayfairDropshipOrder[]> {
  const endpoint = getDropshipApiBase(account.use_sandbox);
  const all: WayfairDropshipOrder[] = [];
  let cursor = fromDate || null;

  while (true) {
    let result: DSResponse;
    try {
      result = await graphqlQuery<DSResponse>(
        account,
        DS_QUERY,
        {
          limit: PAGE_LIMIT,
          hasResponse: hasResponse ?? null,
          sortOrder: 'ASC',
          fromDate: cursor,
        },
        endpoint
      );
    } catch (err: any) {
      logger.info(`[Wayfair DS][${account.label}] ${err.message || ''}`);
      break;
    }

    const orders = result.getDropshipPurchaseOrders || [];
    if (orders.length === 0) break;

    all.push(...orders);

    if (orders.length < PAGE_LIMIT) break;
    cursor = orders[orders.length - 1].poDate;
  }

  logger.info(`[Wayfair DS][${account.label}] ${all.length} dropship orders fetched (fromDate=${fromDate || 'all'})`);
  return all;
}

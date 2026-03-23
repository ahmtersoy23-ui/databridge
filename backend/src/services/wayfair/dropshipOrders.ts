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
  ) {
    getDropshipPurchaseOrders(
      limit: $limit
      hasResponse: $hasResponse
      sortOrder: $sortOrder
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

export async function fetchDropshipOrders(account: WayfairAccount, hasResponse?: boolean): Promise<WayfairDropshipOrder[]> {
  const endpoint = getDropshipApiBase(account.use_sandbox);

  let result: DSResponse;
  try {
    result = await graphqlQuery<DSResponse>(
      account,
      DS_QUERY,
      {
        limit: 25,
        hasResponse: hasResponse ?? null,
        sortOrder: 'DESC',
      },
      endpoint
    );
  } catch (err: any) {
    const msg: string = err.message || '';
    logger.info(`[Wayfair DS][${account.label}] ${msg}`);
    return [];
  }

  const orders = result.getDropshipPurchaseOrders || [];
  logger.info(`[Wayfair DS][${account.label}] ${orders.length} dropship orders fetched (hasResponse=${hasResponse ?? 'all'})`);
  return orders;
}

import { graphqlQuery, getCredentials, getDropshipApiBase } from './client';
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

// Dropship endpoint: api.wayfair.com (different from CastleGate api.wayfair.io)
// Rate limit: max 25 orders per call, query every 30 minutes
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

export async function fetchDropshipOrders(hasResponse?: boolean): Promise<WayfairDropshipOrder[]> {
  const creds = await getCredentials();
  const endpoint = getDropshipApiBase(creds.use_sandbox);

  let result: DSResponse;
  try {
    result = await graphqlQuery<DSResponse>(
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
    logger.info(`[Wayfair DS] ${msg}`);
    return [];
  }

  const orders = result.getDropshipPurchaseOrders || [];
  logger.info(`[Wayfair DS] ${orders.length} dropship orders fetched (hasResponse=${hasResponse ?? 'all'})`);
  return orders;
}

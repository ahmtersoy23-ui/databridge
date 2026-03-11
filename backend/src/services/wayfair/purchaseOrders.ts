import { graphqlQuery, getCredentials, getDropshipApiBase } from './client';
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

// getCastleGatePurchaseOrders — api.wayfair.com (same host as Dropship, NOT api.wayfair.io)
// Rate limit: max 25 orders per call, every 30 minutes
const CG_QUERY = `
  query getCastleGatePurchaseOrders(
    $limit: Int32
    $hasResponse: Boolean
    $sortOrder: SortOrder
  ) {
    getCastleGatePurchaseOrders(
      limit: $limit
      hasResponse: $hasResponse
      sortOrder: $sortOrder
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

export async function fetchWayfairPurchaseOrders(hasResponse?: boolean): Promise<WayfairCGOrder[]> {
  const creds = await getCredentials();
  const endpoint = getDropshipApiBase(creds.use_sandbox); // same api.wayfair.com endpoint

  let result: CGResponse;
  try {
    result = await graphqlQuery<CGResponse>(
      CG_QUERY,
      {
        limit: 25,
        hasResponse: hasResponse ?? null,
        sortOrder: 'DESC',
      },
      endpoint
    );
  } catch (err: any) {
    const msg: string = err.message || '';
    logger.info(`[Wayfair CG] ${msg}`);
    return [];
  }

  const orders = result.getCastleGatePurchaseOrders || [];
  logger.info(`[Wayfair CG] ${orders.length} CastleGate orders fetched (hasResponse=${hasResponse ?? 'all'})`);
  return orders;
}

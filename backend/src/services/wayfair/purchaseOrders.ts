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

export async function fetchWayfairPurchaseOrders(account: WayfairAccount, hasResponse?: boolean): Promise<WayfairCGOrder[]> {
  const endpoint = getDropshipApiBase(account.use_sandbox);

  let result: CGResponse;
  try {
    result = await graphqlQuery<CGResponse>(
      account,
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
    logger.info(`[Wayfair CG][${account.label}] ${msg}`);
    return [];
  }

  const orders = result.getCastleGatePurchaseOrders || [];
  logger.info(`[Wayfair CG][${account.label}] ${orders.length} CastleGate orders fetched (hasResponse=${hasResponse ?? 'all'})`);
  return orders;
}

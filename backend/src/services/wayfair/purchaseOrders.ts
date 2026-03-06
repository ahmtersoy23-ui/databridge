import { graphqlQuery, getSupplierId } from './client';
import logger from '../../config/logger';

export interface WayfairLineItem {
  partNumber: string;
  quantity: number;
  unitPrice?: number;
}

export interface WayfairPurchaseOrder {
  poNumber: string;
  status: string;
  orderDate: string;
  expectedShipDate?: string;
  lineItems: WayfairLineItem[];
}

// getCastleGatePurchaseOrders — confirmed name from schema introspection
// hasResponse=false → open (no response yet), omit → all orders
const PO_QUERY = `
  query GetCastleGatePOs($supplierId: Int!, $hasResponse: Boolean, $first: Int!, $cursor: String) {
    getCastleGatePurchaseOrders(
      supplierId: $supplierId
      hasResponse: $hasResponse
      page: { first: $first, after: $cursor }
    ) {
      edges {
        node {
          poNumber
          status
          orderDate
          estimatedShipDate
          lineItems {
            partNumber
            quantity
            unitPrice
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

interface PONode {
  poNumber: string;
  status: string;
  orderDate: string;
  estimatedShipDate?: string;
  lineItems?: { partNumber: string; quantity: number; unitPrice?: number }[];
}

interface POResponse {
  getCastleGatePurchaseOrders: {
    edges: { node: PONode }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

export async function fetchWayfairPurchaseOrders(): Promise<WayfairPurchaseOrder[]> {
  const supplierId = await getSupplierId();
  const all: WayfairPurchaseOrder[] = [];
  let cursor: string | null = null;
  let page = 0;

  while (true) {
    let result: POResponse;
    try {
      result = await graphqlQuery<POResponse>(PO_QUERY, {
        supplierId,
        first: 50,
        cursor: cursor ?? undefined,
      });
    } catch (err: any) {
      if (err.message?.includes('wrongly returned a null value')) {
        logger.info('[Wayfair PO] No orders available (sandbox limitation)');
        break;
      }
      throw err;
    }

    const conn: POResponse['getCastleGatePurchaseOrders'] = result.getCastleGatePurchaseOrders;
    if (!conn?.edges?.length) break;

    for (const { node } of conn.edges) {
      all.push({
        poNumber: node.poNumber,
        status: node.status,
        orderDate: node.orderDate,
        expectedShipDate: node.estimatedShipDate,
        lineItems: (node.lineItems || []).map(li => ({
          partNumber: li.partNumber,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
        })),
      });
    }

    logger.info(`[Wayfair PO] Page ${page}: ${conn.edges.length} orders (total: ${all.length})`);

    if (!conn.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
    page++;
  }

  return all;
}

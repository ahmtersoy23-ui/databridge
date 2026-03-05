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

// Cursor-based PO query — query name and shape to be confirmed via /api/v1/wayfair/settings/schema
const PO_QUERY = `
  query GetPurchaseOrders($supplierId: Int!, $first: Int!, $cursor: String) {
    purchaseOrders(
      supplierId: $supplierId
      page: { first: $first, after: $cursor }
    ) {
      edges {
        node {
          poNumber
          status
          orderDate
          expectedShipDate
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
  expectedShipDate?: string;
  lineItems?: { partNumber: string; quantity: number; unitPrice?: number }[];
}

interface POResponse {
  purchaseOrders: {
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
    const result: POResponse = await graphqlQuery<POResponse>(PO_QUERY, {
      supplierId,
      first: 50,
      cursor: cursor ?? undefined,
    });

    const conn: POResponse['purchaseOrders'] = result.purchaseOrders;
    if (!conn?.edges?.length) break;

    for (const { node } of conn.edges) {
      all.push({
        poNumber: node.poNumber,
        status: node.status,
        orderDate: node.orderDate,
        expectedShipDate: node.expectedShipDate,
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

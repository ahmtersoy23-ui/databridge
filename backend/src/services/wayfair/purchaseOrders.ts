import { graphqlQuery } from './client';
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

// getCastleGatePurchaseOrders returns PurchaseOrderV2[] directly (no connection/edges/pageInfo)
// Supplier is inferred from auth token — no supplierId arg needed
const PO_QUERY = `
  query GetCastleGatePOs($hasResponse: Boolean) {
    getCastleGatePurchaseOrders(hasResponse: $hasResponse) {
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
`;

interface PONode {
  poNumber: string;
  status: string;
  orderDate: string;
  estimatedShipDate?: string;
  lineItems?: { partNumber: string; quantity: number; unitPrice?: number }[];
}

interface POResponse {
  getCastleGatePurchaseOrders: PONode[];
}

export async function fetchWayfairPurchaseOrders(): Promise<WayfairPurchaseOrder[]> {
  let result: POResponse;
  try {
    result = await graphqlQuery<POResponse>(PO_QUERY);
  } catch (err: any) {
    if (err.message?.includes('wrongly returned a null value')) {
      logger.info('[Wayfair PO] No orders available (sandbox limitation)');
      return [];
    }
    throw err;
  }

  const orders = result.getCastleGatePurchaseOrders || [];
  logger.info(`[Wayfair PO] ${orders.length} orders fetched`);

  return orders.map(node => ({
    poNumber: node.poNumber,
    status: node.status,
    orderDate: node.orderDate,
    expectedShipDate: node.estimatedShipDate,
    lineItems: (node.lineItems || []).map(li => ({
      partNumber: li.partNumber,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
    })),
  }));
}

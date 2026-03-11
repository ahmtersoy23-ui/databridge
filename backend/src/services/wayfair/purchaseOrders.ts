import { graphqlQuery } from './client';
import logger from '../../config/logger';

export interface WayfairLineItem {
  partNumber: string;
  quantity: number;
  price?: number;
}

export interface WayfairPurchaseOrder {
  poNumber: string;
  orderType: string;
  poDate: string;
  estimatedShipDate?: string;
  lineItems: WayfairLineItem[];
}

// getCastleGatePurchaseOrders returns PurchaseOrderV2[] directly (no connection/edges/pageInfo)
// Supplier is inferred from auth token — no supplierId arg needed
// PurchaseOrderV2 actual fields: poNumber, poDate, estimatedShipDate, orderType, products, ...
const PO_QUERY = `
  query GetCastleGatePOs($hasResponse: Boolean) {
    getCastleGatePurchaseOrders(hasResponse: $hasResponse) {
      poNumber
      poDate
      estimatedShipDate
      orderType
      products {
        partNumber
        quantity
        price
      }
    }
  }
`;

interface PONode {
  poNumber: string;
  orderType: string;
  poDate: string;
  estimatedShipDate?: string;
  products?: { partNumber: string; quantity: number; price?: number }[];
}

interface POResponse {
  getCastleGatePurchaseOrders: PONode[];
}

export async function fetchWayfairPurchaseOrders(): Promise<WayfairPurchaseOrder[]> {
  let result: POResponse;
  try {
    result = await graphqlQuery<POResponse>(PO_QUERY);
  } catch (err: any) {
    const msg: string = err.message || '';
    if (
      msg.includes('wrongly returned a null value') ||
      msg.includes('failed to retrieve CG PO') ||
      msg.includes('Internal Server Error') ||
      msg.includes('something went wrong')
    ) {
      logger.info(`[Wayfair PO] No CastleGate POs available: ${msg}`);
      return [];
    }
    throw err;
  }

  const orders = result.getCastleGatePurchaseOrders || [];
  logger.info(`[Wayfair PO] ${orders.length} orders fetched`);

  return orders.map(node => ({
    poNumber: node.poNumber,
    orderType: node.orderType,
    poDate: node.poDate,
    estimatedShipDate: node.estimatedShipDate,
    lineItems: (node.products || []).map(p => ({
      partNumber: p.partNumber,
      quantity: p.quantity,
      price: p.price,
    })),
  }));
}

import { graphqlQuery, getSupplierId } from './client';
import logger from '../../config/logger';

export interface WayfairLineItem {
  supplierPartNumber: string;
  partNumber: string;
  productName?: string;
  quantityOrdered: number;
  quantityShipped: number;
  unitPrice?: number;
  status: string;
  trackingNumbers?: string[];
}

export interface WayfairPurchaseOrder {
  requestId: string;
  status: string;
  statusLabel: string;
  orderDate: string;
  customerOrderNumber?: string;
  retailerName?: string;
  shippingAddress?: {
    name?: string;
    city?: string;
    stateShortName?: string;
    postalCode?: string;
    countryShortName?: string;
  };
  lineItems: WayfairLineItem[];
}

// fulfillmentOrderDetailsList — CastleGate Multi-Channel Order API
// Page-based pagination (page + pageSize, max 100)
const ORDERS_QUERY = `
  query FulfillmentOrderDetailsList($orderDetailsListInput: FulfillmentOrderDetailsListInput!) {
    fulfillmentOrderDetailsList(orderDetailsListInput: $orderDetailsListInput) {
      pageInfo {
        hasNextPage
        totalPages
        totalItems
      }
      nodes {
        fulfillmentOrder {
          requestId
          status
          statusLabel
          orderDate
          customerOrderNumber
          retailer {
            name
          }
          shippingAddress {
            name
            city
            stateShortName
            postalCode
            countryShortName
          }
          fulfillmentOrderItems {
            supplierPartNumber
            partNumber
            supplierProductName
            quantityOrdered
            quantityShipped
            unitPrice
            status
            trackingNumbers
          }
        }
      }
    }
  }
`;

interface FulfillmentOrderItem {
  supplierPartNumber?: string;
  partNumber?: string;
  supplierProductName?: string;
  quantityOrdered?: number;
  quantityShipped?: number;
  unitPrice?: number;
  status?: string;
  trackingNumbers?: string[];
}

interface FulfillmentOrder {
  requestId: string;
  status: string;
  statusLabel: string;
  orderDate?: string;
  customerOrderNumber?: string;
  retailer?: { name?: string };
  shippingAddress?: {
    name?: string;
    city?: string;
    stateShortName?: string;
    postalCode?: string;
    countryShortName?: string;
  };
  fulfillmentOrderItems?: FulfillmentOrderItem[];
}

interface FulfillmentOrdersResponse {
  fulfillmentOrderDetailsList: {
    pageInfo: { hasNextPage: boolean; totalPages: number; totalItems: number };
    nodes: { fulfillmentOrder: FulfillmentOrder }[];
  };
}

export async function fetchWayfairPurchaseOrders(): Promise<WayfairPurchaseOrder[]> {
  const supplierId = await getSupplierId();
  const all: WayfairPurchaseOrder[] = [];
  let page = 1;

  while (true) {
    let result: FulfillmentOrdersResponse;
    try {
      result = await graphqlQuery<FulfillmentOrdersResponse>(ORDERS_QUERY, {
        orderDetailsListInput: { supplierId, page, pageSize: 100 },
      });
    } catch (err: any) {
      const msg: string = err.message || '';
      logger.info(`[Wayfair Orders] ${msg}`);
      return all;
    }

    const conn = result.fulfillmentOrderDetailsList;
    if (!conn?.nodes?.length) break;

    for (const { fulfillmentOrder: o } of conn.nodes) {
      all.push({
        requestId: o.requestId,
        status: o.status,
        statusLabel: o.statusLabel,
        orderDate: o.orderDate || '',
        customerOrderNumber: o.customerOrderNumber,
        retailerName: o.retailer?.name,
        shippingAddress: o.shippingAddress,
        lineItems: (o.fulfillmentOrderItems || []).map(item => ({
          supplierPartNumber: item.supplierPartNumber || '',
          partNumber: item.partNumber || '',
          productName: item.supplierProductName,
          quantityOrdered: item.quantityOrdered ?? 0,
          quantityShipped: item.quantityShipped ?? 0,
          unitPrice: item.unitPrice,
          status: item.status || '',
          trackingNumbers: item.trackingNumbers || [],
        })),
      });
    }

    logger.info(`[Wayfair Orders] Page ${page}/${conn.pageInfo.totalPages}: ${conn.nodes.length} orders (total: ${all.length}/${conn.pageInfo.totalItems})`);

    if (!conn.pageInfo.hasNextPage) break;
    page++;
  }

  return all;
}

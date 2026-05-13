import logger from '../../config/logger';
import { walmartGet, type WalmartAccount } from './client';

// -- Response types (subset of Walmart /v3/orders) -------------------------

export interface WalmartOrderLineStatus {
  status?: string;
  statusQuantity?: { amount?: string; unitOfMeasurement?: string };
}

export interface WalmartCharge {
  chargeType?: string;
  chargeName?: string;
  chargeAmount?: { currency?: string; amount?: number };
  tax?: { taxName?: string; taxAmount?: { currency?: string; amount?: number } };
}

export interface WalmartOrderLine {
  lineNumber: string;
  item: {
    productName?: string;
    sku: string;
  };
  charges?: { charge: WalmartCharge[] };
  orderLineQuantity: { amount: string; unitOfMeasurement?: string };
  statusDate?: number;
  fulfillment?: { shipNodeType?: string };
  orderLineStatuses?: { orderLineStatus: WalmartOrderLineStatus[] };
}

export interface WalmartOrder {
  purchaseOrderId: string;
  customerOrderId: string;
  customerEmailId?: string;
  orderType?: string;
  orderDate: number; // epoch millis
  shippingInfo?: {
    postalAddress?: {
      postalCode?: string;
      state?: string;
      country?: string;
    };
  };
  orderLines: { orderLine: WalmartOrderLine[] };
}

interface OrdersResponse {
  list?: {
    meta?: { totalCount?: number; limit?: number; nextCursor?: string };
    elements?: { order: WalmartOrder[] };
  };
}

// -- Parsed row ready for insertion ---------------------------------------

export interface WalmartParsedOrderLine {
  customer_order_id: string;
  purchase_order_id: string;
  order_date: Date;
  order_date_local: string; // YYYY-MM-DD
  line_number: string;
  sku: string;
  product_name: string | null;
  quantity: number;
  unit_price: number;
  item_price: number;
  currency: string;
  order_status: string | null;
  ship_node_type: string | null;
  customer_email_marketing: string | null;
  shipping_postal_code: string | null;
  shipping_state: string | null;
  shipping_country: string | null;
}

function parseOrder(order: WalmartOrder): WalmartParsedOrderLine[] {
  const orderDate = new Date(order.orderDate);
  const localDate = orderDate.toISOString().slice(0, 10);

  return order.orderLines.orderLine.map(line => {
    const quantity = parseInt(line.orderLineQuantity.amount, 10) || 0;

    // Walmart returns product price under charges[].chargeType=PRODUCT.chargeAmount
    const productCharge = line.charges?.charge?.find(c => c.chargeType === 'PRODUCT');
    const unitPrice = productCharge?.chargeAmount?.amount ?? 0;
    const currency = productCharge?.chargeAmount?.currency ?? 'USD';

    // Latest status (orderLineStatuses is an array, take last)
    const statuses = line.orderLineStatuses?.orderLineStatus ?? [];
    const latestStatus = statuses[statuses.length - 1]?.status ?? null;

    return {
      customer_order_id: order.customerOrderId,
      purchase_order_id: order.purchaseOrderId,
      order_date: orderDate,
      order_date_local: localDate,
      line_number: line.lineNumber,
      sku: line.item.sku,
      product_name: line.item.productName ?? null,
      quantity,
      unit_price: unitPrice,
      item_price: unitPrice * quantity, // line total (matches raw_orders.item_price semantics)
      currency,
      order_status: latestStatus,
      ship_node_type: line.fulfillment?.shipNodeType ?? null,
      customer_email_marketing: order.customerEmailId ?? null,
      shipping_postal_code: order.shippingInfo?.postalAddress?.postalCode ?? null,
      shipping_state: order.shippingInfo?.postalAddress?.state ?? null,
      shipping_country: order.shippingInfo?.postalAddress?.country ?? null,
    };
  });
}

// -- Fetch with cursor pagination -----------------------------------------

export interface FetchOrdersOptions {
  /** ISO date YYYY-MM-DD — required by Walmart */
  createdStartDate: string;
  /** ISO date YYYY-MM-DD — optional */
  createdEndDate?: string;
  /** Per-page limit (Walmart max 200 for /v3/orders; default 100) */
  limit?: number;
  /** Hard stop on total orders (safety) — default 10000 (Walmart's hard cap) */
  maxOrders?: number;
}

export async function fetchOrders(
  account: WalmartAccount,
  opts: FetchOrdersOptions
): Promise<WalmartParsedOrderLine[]> {
  const limit = opts.limit ?? 100;
  const maxOrders = opts.maxOrders ?? 10_000;

  const allRows: WalmartParsedOrderLine[] = [];
  let cursor: string | undefined;
  let pageCount = 0;
  let orderCount = 0;

  while (true) {
    pageCount++;
    let resp: OrdersResponse;

    if (cursor) {
      // nextCursor expires in 2 minutes — fetch next page immediately, no sleep
      resp = await walmartGet<OrdersResponse>(account, '/v3/orders', { cursor });
    } else {
      resp = await walmartGet<OrdersResponse>(account, '/v3/orders', {
        params: {
          createdStartDate: opts.createdStartDate,
          createdEndDate: opts.createdEndDate,
          limit,
        },
      });
    }

    const orders = resp.list?.elements?.order ?? [];
    if (orders.length === 0) {
      logger.info(`[Walmart] '${account.label}' page ${pageCount}: empty, stopping`);
      break;
    }

    for (const order of orders) {
      allRows.push(...parseOrder(order));
      orderCount++;
    }

    logger.info(
      `[Walmart] '${account.label}' page ${pageCount}: ${orders.length} orders ` +
      `(running total: ${orderCount})`
    );

    if (orderCount >= maxOrders) {
      logger.warn(`[Walmart] '${account.label}' hit maxOrders=${maxOrders}, stopping`);
      break;
    }

    cursor = resp.list?.meta?.nextCursor;
    if (!cursor) break;

    // Strip leading "?" if present (Walmart returns "?key=val&...")
    if (cursor.startsWith('?')) cursor = cursor.slice(1);
  }

  logger.info(
    `[Walmart] '${account.label}' fetched ${orderCount} orders across ${pageCount} pages ` +
    `(${allRows.length} order lines)`
  );
  return allRows;
}

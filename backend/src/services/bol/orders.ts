import logger from '../../config/logger';
import { bolGet, type BolAccount } from './client';

// -- /orders response types ------------------------------------------------

export interface BolOrderItem {
  orderItemId: string;
  ean?: string;
  fulfilment?: { method?: 'FBR' | 'FBB'; latestDeliveryDate?: string };
  offer?: { reference?: string };  // seller SKU
  product?: { title?: string };
  quantity: number;
  unitPrice?: number;
}

export interface BolOrder {
  orderId: string;
  orderPlacedDateTime: string;     // ISO 8601 with timezone offset
  orderItems: BolOrderItem[];
}

interface OrdersListResponse {
  orders?: BolOrder[];
}

// -- /shipments response types ---------------------------------------------

export interface BolShipmentItem {
  orderItemId: string;
  ean?: string;
  fulfilmentMethod?: 'FBR' | 'FBB';
  offer?: { reference?: string };  // seller SKU
  product?: { title?: string };
  quantity?: number;
  quantityShipped?: number;
  unitPrice?: number;
}

export interface BolShipment {
  shipmentId: string;
  shipmentDate?: string;            // ISO 8601
  shipmentReference?: string;
  order?: { orderId: string; orderPlacedDateTime?: string };
  shipmentItems: BolShipmentItem[];
}

interface ShipmentsListResponse {
  shipments?: BolShipment[];
}

// -- Parsed row ready for insertion ---------------------------------------

export interface BolParsedOrderLine {
  account_id: number;
  order_id: string;
  order_item_id: string;
  order_placed_at: Date;
  order_date_local: string;        // YYYY-MM-DD
  sku: string | null;
  ean: string | null;
  product_title: string | null;
  quantity: number;
  unit_price: number;
  item_price: number;               // unit_price * quantity (line total)
  currency: string;
  fulfilment_method: string | null;
}

function parseOrder(account: BolAccount, order: BolOrder): BolParsedOrderLine[] {
  const placed = new Date(order.orderPlacedDateTime);
  const localDate = placed.toISOString().slice(0, 10);

  return order.orderItems.map(item => {
    const qty = Number(item.quantity) || 0;
    const unitPrice = Number(item.unitPrice) || 0;
    return {
      account_id: account.id,
      order_id: order.orderId,
      order_item_id: item.orderItemId,
      order_placed_at: placed,
      order_date_local: localDate,
      sku: item.offer?.reference ?? null,
      ean: item.ean ?? null,
      product_title: item.product?.title ?? null,
      quantity: qty,
      unit_price: unitPrice,
      item_price: unitPrice * qty,
      currency: 'EUR',
      fulfilment_method: item.fulfilment?.method ?? null,
    };
  });
}

function parseShipment(account: BolAccount, shipment: BolShipment): BolParsedOrderLine[] {
  // Prefer orderPlacedDateTime; fall back to shipmentDate if order info absent
  const placed = new Date(shipment.order?.orderPlacedDateTime || shipment.shipmentDate || Date.now());
  const localDate = placed.toISOString().slice(0, 10);
  const orderId = shipment.order?.orderId || shipment.shipmentId;

  return shipment.shipmentItems.map(item => {
    const qty = Number(item.quantityShipped ?? item.quantity) || 0;
    const unitPrice = Number(item.unitPrice) || 0;
    return {
      account_id: account.id,
      order_id: orderId,
      order_item_id: item.orderItemId,
      order_placed_at: placed,
      order_date_local: localDate,
      sku: item.offer?.reference ?? null,
      ean: item.ean ?? null,
      product_title: item.product?.title ?? null,
      quantity: qty,
      unit_price: unitPrice,
      item_price: unitPrice * qty,
      currency: 'EUR',
      fulfilment_method: item.fulfilmentMethod ?? null,
    };
  });
}

// -- Fetch with page pagination -------------------------------------------

export interface FetchBolOrdersOptions {
  /** ISO date YYYY-MM-DD for latest-change-date filter (max 3 months back) */
  latestChangeDate?: string;
  /** ALL = OPEN + handled (default); OPEN = needs shipment */
  status?: 'OPEN' | 'SHIPPED' | 'ALL';
  /** FBR = self-fulfilled (default for IWA), FBB = Bol warehouse, ALL */
  fulfilmentMethod?: 'FBR' | 'FBB' | 'ALL';
  /** Hard stop on pages (safety) — default 500 (50k items) */
  maxPages?: number;
}

export async function fetchOrders(
  account: BolAccount,
  opts: FetchBolOrdersOptions = {},
): Promise<BolParsedOrderLine[]> {
  const status = opts.status ?? 'ALL';
  const fulfilmentMethod = opts.fulfilmentMethod ?? 'FBR';
  const maxPages = opts.maxPages ?? 500;

  const allRows: BolParsedOrderLine[] = [];
  let page = 1;
  let orderCount = 0;

  while (page <= maxPages) {
    const resp = await bolGet<OrdersListResponse>(account, '/orders', {
      params: {
        page,
        status,
        'fulfilment-method': fulfilmentMethod,
        'latest-change-date': opts.latestChangeDate,
      },
    });

    const orders = resp.orders ?? [];
    if (orders.length === 0) {
      logger.info(`[Bol] '${account.label}' page ${page}: empty, stopping`);
      break;
    }

    for (const order of orders) {
      allRows.push(...parseOrder(account, order));
      orderCount++;
    }

    logger.info(
      `[Bol] '${account.label}' page ${page}: ${orders.length} orders ` +
      `(running total: ${orderCount})`
    );
    page++;
  }

  logger.info(
    `[Bol] '${account.label}' fetched ${orderCount} orders across ${page - 1} pages ` +
    `(${allRows.length} order items)`
  );
  return allRows;
}

// -- /shipments fetch (3 ay historical data, /orders'in 48h sinirina alternatif) --

export interface FetchBolShipmentsOptions {
  fulfilmentMethod?: 'FBR' | 'FBB';
  maxPages?: number;
}

export async function fetchShipments(
  account: BolAccount,
  opts: FetchBolShipmentsOptions = {},
): Promise<BolParsedOrderLine[]> {
  const fulfilmentMethod = opts.fulfilmentMethod ?? 'FBR';
  const maxPages = opts.maxPages ?? 500;

  // 1) List endpoint → shipmentId'leri topla (slim data)
  const shipmentIds: string[] = [];
  let page = 1;

  while (page <= maxPages) {
    const resp = await bolGet<ShipmentsListResponse>(account, '/shipments', {
      params: { page, 'fulfilment-method': fulfilmentMethod },
    });
    const list = resp.shipments ?? [];
    if (list.length === 0) {
      logger.info(`[Bol] '${account.label}' shipments list page ${page}: empty, stopping`);
      break;
    }
    for (const s of list) shipmentIds.push(s.shipmentId);
    logger.info(
      `[Bol] '${account.label}' shipments list page ${page}: ${list.length} IDs ` +
      `(running total: ${shipmentIds.length})`,
    );
    page++;
  }

  if (shipmentIds.length === 0) return [];

  // 2) Detay endpoint → her shipmentId icin tam orderItem detayi
  logger.info(`[Bol] '${account.label}' fetching detail for ${shipmentIds.length} shipments...`);
  const allRows: BolParsedOrderLine[] = [];
  let fetched = 0;
  for (const id of shipmentIds) {
    try {
      const detail = await bolGet<BolShipment>(account, `/shipments/${id}`);
      allRows.push(...parseShipment(account, detail));
      fetched++;
      if (fetched % 50 === 0) {
        logger.info(`[Bol] '${account.label}' detail progress: ${fetched}/${shipmentIds.length}`);
      }
    } catch (err: any) {
      logger.warn(`[Bol] '${account.label}' detail ${id} failed: ${err.message}`);
    }
  }

  logger.info(
    `[Bol] '${account.label}' fetched ${fetched}/${shipmentIds.length} shipment details ` +
    `(${allRows.length} order items)`,
  );
  return allRows;
}

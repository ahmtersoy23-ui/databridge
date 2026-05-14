import logger from '../../config/logger';
import { kauflandRequest, storefrontCode, type KauflandAccount } from './client';

// -- Response types (subset of Kaufland /v2/orders) ------------------------

interface KauflandOrderListItem {
  id_order: string;
  ts_created_iso: string;
  ts_units_updated_iso?: string;
  storefront: string;
  order_units_count?: number;
  fulfillment_type?: string;
}

interface OrdersListResponse {
  data?: KauflandOrderListItem[];
  pagination?: { offset: number; limit: number; total: number };
}

interface KauflandOrderUnit {
  id_order_unit: number;
  id_offer?: string | null;          // seller offer/SKU (often iwasku-formatted)
  status?: string;
  price?: number;                    // cents
  revenue_gross?: number;
  revenue_net?: number;
  currency?: string;
  ts_created_iso?: string;
  product?: {
    id_product?: number;
    title?: string;
    eans?: string[];
  };
  cancel_reason?: string | null;
}

interface KauflandOrderDetail {
  id_order: string;
  ts_created_iso: string;
  storefront: string;
  order_units?: KauflandOrderUnit[];
  fulfillment_type?: string;
}

interface OrderDetailResponse {
  data?: KauflandOrderDetail;
}

// -- Parsed row -----------------------------------------------------------

export interface KauflandParsedOrderLine {
  id_order: string;
  id_order_unit: string;
  storefront: string;
  order_date: Date;
  order_date_local: string;
  ean: string | null;
  offer_sku: string | null;          // id_offer
  product_title: string | null;
  product_id_unit: string | null;    // id_product (Kaufland's internal product ID)
  quantity: number;
  unit_price: number;
  item_price: number;
  currency: string;
  status: string | null;
  is_cancelled: boolean;
}

function parseDetail(detail: KauflandOrderDetail): KauflandParsedOrderLine[] {
  const orderDate = new Date(detail.ts_created_iso);
  const localDate = orderDate.toISOString().slice(0, 10);
  const units = detail.order_units ?? [];

  return units.map(u => {
    // Kaufland order_units are per-item; each row = 1 unit.
    const quantity = 1;
    // Prices in cents (integer). Use revenue_gross (post-fees, what we actually receive)
    // if present, else fall back to price; convert cents → currency.
    const unitPriceCents = u.revenue_gross ?? u.price ?? 0;
    const unitPrice = +(unitPriceCents / 100).toFixed(2);
    const status = u.status ?? null;
    return {
      id_order: detail.id_order,
      id_order_unit: String(u.id_order_unit),
      storefront: detail.storefront,
      order_date: orderDate,
      order_date_local: localDate,
      // Coerce empty strings to null — Kaufland often returns offer_sku/ean
      // as '' for products listed by EAN-only or auto-generated offers, which
      // then breaks downstream IS NOT NULL / COALESCE / unique-constraint
      // checks (saw 'marketplace_sku=""' validation failures in mapping UI).
      ean: u.product?.eans?.[0] || null,
      offer_sku: u.id_offer || null,
      product_title: u.product?.title || null,
      product_id_unit: u.product?.id_product != null ? String(u.product.id_product) : null,
      quantity,
      unit_price: unitPrice,
      item_price: unitPrice,           // quantity is always 1, so item = unit
      currency: u.currency ?? 'EUR',
      status,
      // 'cancelled' is the explicit cancellation status; 'sent'/'shipped'/'open' are not cancelled.
      is_cancelled: typeof status === 'string' && /cancel/i.test(status),
    };
  });
}

// -- Public API -----------------------------------------------------------

export interface FetchOrdersOptions {
  /** Unix epoch seconds — orders created at/after this timestamp */
  tsFrom: number;
  /** Per-page limit (Kaufland default 30, max 100) */
  limit?: number;
  /** Hard safety cap on total orders fetched */
  maxOrders?: number;
  /** Throttle between detail calls (ms). Kaufland ≈ 2req/s, so default 600ms. */
  detailThrottleMs?: number;
}

/**
 * Fetch all orders since `tsFrom` for this account/storefront, then expand each
 * order via /orders/{id} (no embed param — order_units come in default response).
 */
export async function fetchOrdersWithUnits(
  account: KauflandAccount,
  opts: FetchOrdersOptions
): Promise<KauflandParsedOrderLine[]> {
  const limit = opts.limit ?? 100;
  const maxOrders = opts.maxOrders ?? 10_000;
  const throttle = opts.detailThrottleMs ?? 600;

  // 1) List orders (paginated)
  const listIds: string[] = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total && listIds.length < maxOrders) {
    const resp = await kauflandRequest<OrdersListResponse>(account, 'GET', '/orders', {
      query: {
        storefront: storefrontCode(account),
        ts_from: opts.tsFrom,
        limit,
        offset,
      },
    });
    const items = resp.data ?? [];
    total = resp.pagination?.total ?? items.length;
    items.forEach(it => listIds.push(it.id_order));

    logger.info(
      `[Kaufland] '${account.label}' list page offset=${offset}: ${items.length} orders ` +
      `(total=${total}, running=${listIds.length})`
    );

    if (items.length < limit) break;
    offset += limit;
  }

  logger.info(`[Kaufland] '${account.label}' collected ${listIds.length} order IDs, fetching details…`);

  // 2) Detail per order (no embed param — order_units present in default response)
  const allRows: KauflandParsedOrderLine[] = [];
  let detailFails = 0;

  for (let i = 0; i < listIds.length; i++) {
    const id = listIds[i];
    try {
      const resp = await kauflandRequest<OrderDetailResponse>(
        account,
        'GET',
        `/orders/${encodeURIComponent(id)}`,
        { skipCircuitBreaker: true }
      );
      if (resp.data) allRows.push(...parseDetail(resp.data));
    } catch (err: any) {
      detailFails++;
      const msg = err.message ?? '';
      if (/429/.test(msg)) {
        logger.warn(`[Kaufland] 429 on '${id}', sleeping 5s`);
        await new Promise(r => setTimeout(r, 5000));
      } else {
        logger.warn(`[Kaufland] detail fetch failed '${id}': ${msg}`);
      }
    }
    if (i + 1 < listIds.length) await new Promise(r => setTimeout(r, throttle));
  }

  logger.info(
    `[Kaufland] '${account.label}' fetched ${allRows.length} order units ` +
    `from ${listIds.length} orders (${detailFails} detail failures)`
  );
  return allRows;
}

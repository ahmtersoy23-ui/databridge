import logger from '../../config/logger';
import { kauflandRequest, type KauflandAccount } from './client';

// -- Response types (subset of Kaufland /v2/orders) ------------------------

interface KauflandOrderListItem {
  id_order: string;
  ts_created_iso: string;            // ISO 8601
  ts_units_updated_iso?: string;
  storefront: string;
  order_units_count?: number;
  is_marketplace_deemed_supplier?: boolean;
}

interface OrdersListResponse {
  data?: KauflandOrderListItem[];
  pagination?: { offset: number; limit: number; total: number };
}

interface KauflandOrderUnit {
  id_order_unit: string;
  id_offer?: string;
  ean?: string | null;
  offer_sku?: string | null;
  title?: string | null;
  amount?: number;
  unit_price?: number;
  currency?: string;
  status?: string;
  ts_created_iso?: string;
  id_product_unit?: string;
}

interface KauflandOrderDetail {
  id_order: string;
  ts_created_iso: string;
  storefront: string;
  status?: string;
  units?: KauflandOrderUnit[];
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
  offer_sku: string | null;
  product_title: string | null;
  product_id_unit: string | null;
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
  const units = detail.units ?? [];

  return units.map(u => {
    const quantity = Number(u.amount ?? 1);
    const unitPrice = Number(u.unit_price ?? 0);
    const status = u.status ?? detail.status ?? null;
    return {
      id_order: detail.id_order,
      id_order_unit: u.id_order_unit,
      storefront: detail.storefront,
      order_date: orderDate,
      order_date_local: localDate,
      ean: u.ean ?? null,
      offer_sku: u.offer_sku ?? null,
      product_title: u.title ?? null,
      product_id_unit: u.id_product_unit ?? null,
      quantity,
      unit_price: unitPrice,
      item_price: +(unitPrice * quantity).toFixed(2),
      currency: u.currency ?? 'EUR',
      status,
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
 * order via /orders/{id} to get line items (units). Returns flattened lines.
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
        storefront: account.storefront,
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

  // 2) Detail per order (rate-limit-friendly)
  const allRows: KauflandParsedOrderLine[] = [];
  let detailFails = 0;

  for (let i = 0; i < listIds.length; i++) {
    const id = listIds[i];
    try {
      const resp = await kauflandRequest<OrderDetailResponse>(
        account,
        'GET',
        `/orders/${encodeURIComponent(id)}`,
        { query: { embedded: 'units' }, skipCircuitBreaker: true }
      );
      if (resp.data) allRows.push(...parseDetail(resp.data));
    } catch (err: any) {
      detailFails++;
      const msg = err.message ?? '';
      // Hit rate limit? back off harder.
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

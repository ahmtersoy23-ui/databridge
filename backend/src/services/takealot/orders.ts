import logger from '../../config/logger';
import { takealotGet, type TakealotAccount } from './client';

// -- /v2/sales response types ----------------------------------------------

export interface TakealotSale {
  order_id: number;
  order_item_id: number;
  order_date: string;            // ISO 8601 string
  sku?: string;
  tsin?: number;
  product_title?: string;
  quantity?: number;
  selling_price?: number;
  dc?: string;
  customer_dc?: string;
  sale_status?: boolean;          // true=settled/shipped, false=cancelled
  promotion?: boolean | null;
  stock_source_region?: string;
}

interface SalesListResponse {
  page_summary?: { page_size: number; page_number: number; total: number };
  sales?: TakealotSale[];
}

// -- Parsed row ready for insertion ---------------------------------------

export interface TakealotParsedOrderLine {
  order_id: number;
  order_item_id: number;
  order_date: Date;
  order_date_local: string;       // YYYY-MM-DD
  sku: string | null;
  tsin: number | null;
  product_title: string | null;
  quantity: number;
  selling_price: number;
  item_price: number;
  currency: string;
  dc: string | null;
  customer_dc: string | null;
  sale_status: boolean | null;
  promotion: boolean | null;
  stock_source_region: string | null;
}

function parseSale(sale: TakealotSale): TakealotParsedOrderLine {
  const placed = new Date(sale.order_date);
  const localDate = placed.toISOString().slice(0, 10);
  const qty = Number(sale.quantity) || 0;
  const unitPrice = Number(sale.selling_price) || 0;
  return {
    order_id: sale.order_id,
    order_item_id: sale.order_item_id,
    order_date: placed,
    order_date_local: localDate,
    sku: sale.sku ?? null,
    tsin: sale.tsin ?? null,
    product_title: sale.product_title ?? null,
    quantity: qty,
    selling_price: unitPrice,
    item_price: unitPrice * qty,
    currency: 'ZAR',
    dc: sale.dc ?? null,
    customer_dc: sale.customer_dc ?? null,
    sale_status: typeof sale.sale_status === 'boolean' ? sale.sale_status : null,
    promotion: typeof sale.promotion === 'boolean' ? sale.promotion : null,
    stock_source_region: sale.stock_source_region ?? null,
  };
}

// -- Fetch sales with page-based pagination -------------------------------

export interface FetchTakealotOrdersOptions {
  startDate: string;              // YYYY-MM-DD
  endDate: string;                // YYYY-MM-DD
  pageSize?: number;              // max 100
  maxPages?: number;              // safety
}

export async function fetchOrders(
  account: TakealotAccount,
  opts: FetchTakealotOrdersOptions,
): Promise<TakealotParsedOrderLine[]> {
  const pageSize = Math.min(opts.pageSize ?? 100, 100);
  const maxPages = opts.maxPages ?? 500;

  const allRows: TakealotParsedOrderLine[] = [];
  let page = 1;
  let saleCount = 0;

  // /v2/sales filters use COMMA separator (semicolon returns 400 "Invalid date format")
  const filters = `start_date:${opts.startDate},end_date:${opts.endDate}`;

  while (page <= maxPages) {
    const resp = await takealotGet<SalesListResponse>(account, '/v2/sales', {
      params: { filters, page_number: page, page_size: pageSize },
    });

    const sales = resp.sales ?? [];
    if (sales.length === 0) {
      logger.info(`[Takealot] '${account.label}' sales page ${page}: empty, stopping`);
      break;
    }

    for (const sale of sales) {
      allRows.push(parseSale(sale));
      saleCount++;
    }

    logger.info(
      `[Takealot] '${account.label}' sales page ${page}: ${sales.length} items ` +
      `(running total: ${saleCount}, server-reported total: ${resp.page_summary?.total ?? 'n/a'})`,
    );

    // Stop early if we've fetched what server claimed
    const serverTotal = resp.page_summary?.total;
    if (serverTotal != null && saleCount >= serverTotal) break;

    page++;
  }

  logger.info(
    `[Takealot] '${account.label}' fetched ${saleCount} sales across ${page} pages`,
  );
  return allRows;
}

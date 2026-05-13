import logger from '../../config/logger';
import { takealotGet, type TakealotAccount } from './client';

// -- /v2/offers response types (subset) -----------------------------------

export interface TakealotOfferWarehouseStock {
  warehouse?: { warehouse_id?: number; name?: string };
  quantity_available?: number;
  quantity?: number;              // some endpoints use plain quantity
}

export interface TakealotOffer {
  offer_id: number;
  tsin_id?: number;
  sku?: string;
  product_label_number?: string;
  selling_price?: number;
  status?: string;
  title?: string;
  leadtime_days?: number;
  stock_at_takealot_total?: number;
  total_stock_on_way?: number;
  total_stock_cover?: number;
  stock_at_takealot?: TakealotOfferWarehouseStock[];
  stock_on_way?: TakealotOfferWarehouseStock[];
  leadtime_stock?: TakealotOfferWarehouseStock[];
}

interface OffersListResponse {
  page_summary?: { page_size: number; page_number: number; total: number };
  offers?: TakealotOffer[];
}

// -- Parsed row ready for insertion ---------------------------------------

export interface TakealotParsedInventoryRow {
  offer_id: number;
  sku: string | null;
  tsin: number | null;
  product_title: string | null;
  selling_price: number;
  status: string | null;
  stock_at_takealot_total: number;
  total_stock_on_way: number;
  total_stock_cover: number;
  leadtime_days: number | null;
  warehouse_stock: TakealotOfferWarehouseStock[];
}

function parseOffer(o: TakealotOffer): TakealotParsedInventoryRow {
  return {
    offer_id: o.offer_id,
    sku: o.sku ?? null,
    tsin: o.tsin_id ?? null,
    product_title: o.title ?? null,
    selling_price: Number(o.selling_price) || 0,
    status: o.status ?? null,
    stock_at_takealot_total: Number(o.stock_at_takealot_total) || 0,
    total_stock_on_way: Number(o.total_stock_on_way) || 0,
    total_stock_cover: Number(o.total_stock_cover) || 0,
    leadtime_days: o.leadtime_days ?? null,
    warehouse_stock: o.stock_at_takealot ?? [],
  };
}

// -- Fetch all offers (page-based) ----------------------------------------

export async function fetchOffers(
  account: TakealotAccount,
  pageSize = 100,
  maxPages = 500,
): Promise<TakealotParsedInventoryRow[]> {
  const allRows: TakealotParsedInventoryRow[] = [];
  let page = 1;
  let offerCount = 0;

  while (page <= maxPages) {
    const resp = await takealotGet<OffersListResponse>(account, '/v2/offers', {
      params: { page_number: page, page_size: pageSize },
    });

    const offers = resp.offers ?? [];
    if (offers.length === 0) {
      logger.info(`[Takealot] '${account.label}' offers page ${page}: empty, stopping`);
      break;
    }

    for (const o of offers) {
      allRows.push(parseOffer(o));
      offerCount++;
    }

    logger.info(
      `[Takealot] '${account.label}' offers page ${page}: ${offers.length} items ` +
      `(total: ${offerCount}, server: ${resp.page_summary?.total ?? 'n/a'})`,
    );

    const serverTotal = resp.page_summary?.total;
    if (serverTotal != null && offerCount >= serverTotal) break;

    // Stop if last page (fewer rows than page_size)
    if (offers.length < pageSize) break;

    page++;
  }

  logger.info(`[Takealot] '${account.label}' fetched ${offerCount} offers across ${page} pages`);
  return allRows;
}

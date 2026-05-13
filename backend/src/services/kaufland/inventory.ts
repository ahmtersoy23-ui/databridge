import logger from '../../config/logger';
import { kauflandRequest, storefrontCode, type KauflandAccount } from './client';

// GET /units returns the seller's listings (offers) with stock and price.
// Note: Kaufland's /units endpoint does NOT include EAN; only id_offer + id_product.
// EAN is exposed via /products/{id_product} but we skip that — id_offer alone is
// enough for iwasku resolve when sellers use iwasku-formatted SKUs.

interface KauflandUnit {
  id_unit: number;
  id_offer?: string | null;
  id_product?: number | null;
  storefront?: string;
  amount?: number;
  price?: number;            // cents
  listing_price?: number;
  status?: string;
  fulfillment_type?: string;
  date_lastchange_iso?: string;
}

interface UnitsListResponse {
  data?: KauflandUnit[];
  pagination?: { offset: number; limit: number; total: number };
}

export interface ParsedUnit {
  id_unit: string;
  ean: string | null;        // always null from /units; EAN backfilled via mapping or order data
  offer_sku: string | null;  // id_offer
  product_title: string | null;
  storefront: string;
  amount: number;
  reserved_amount: number;
  price: number | null;
  status: string | null;
  id_product: string | null;
}

export async function fetchAllUnits(account: KauflandAccount): Promise<ParsedUnit[]> {
  const limit = 100;
  let offset = 0;
  let total = Infinity;
  const all: ParsedUnit[] = [];

  while (offset < total) {
    const resp = await kauflandRequest<UnitsListResponse>(account, 'GET', '/units', {
      query: {
        storefront: storefrontCode(account),
        limit,
        offset,
      },
    });
    const items = resp.data ?? [];
    total = resp.pagination?.total ?? items.length;

    for (const u of items) {
      all.push({
        id_unit: String(u.id_unit),
        ean: null,
        offer_sku: u.id_offer ?? null,
        product_title: null,
        storefront: u.storefront ?? account.storefront,
        amount: Number(u.amount ?? 0),
        reserved_amount: 0,
        price: u.price != null ? +(u.price / 100).toFixed(2) : null,
        status: u.status ?? null,
        id_product: u.id_product != null ? String(u.id_product) : null,
      });
    }

    logger.info(
      `[Kaufland] '${account.label}' units offset=${offset}: ${items.length} ` +
      `(total=${total}, running=${all.length})`
    );

    if (items.length < limit) break;
    offset += limit;
  }

  return all;
}

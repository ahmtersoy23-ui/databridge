import logger from '../../config/logger';
import { kauflandRequest, type KauflandAccount } from './client';

// GET /units returns the seller's listings (offers) with stock and price.

interface KauflandUnit {
  id_unit?: string;
  id_offer?: string;
  ean?: string | null;
  offer_sku?: string | null;
  title?: string | null;
  storefront?: string;
  amount?: number;        // on-hand stock
  reserved_amount?: number;
  price?: number;
  status?: string;
}

interface UnitsListResponse {
  data?: KauflandUnit[];
  pagination?: { offset: number; limit: number; total: number };
}

export interface ParsedUnit {
  id_unit: string;
  ean: string | null;
  offer_sku: string | null;
  product_title: string | null;
  storefront: string;
  amount: number;
  reserved_amount: number;
  price: number | null;
  status: string | null;
}

export async function fetchAllUnits(account: KauflandAccount): Promise<ParsedUnit[]> {
  const limit = 100;
  let offset = 0;
  let total = Infinity;
  const all: ParsedUnit[] = [];

  while (offset < total) {
    const resp = await kauflandRequest<UnitsListResponse>(account, 'GET', '/units', {
      query: {
        storefront: account.storefront,
        limit,
        offset,
      },
    });
    const items = resp.data ?? [];
    total = resp.pagination?.total ?? items.length;

    for (const u of items) {
      const id = u.id_unit ?? u.id_offer;
      if (!id) continue;
      all.push({
        id_unit: String(id),
        ean: u.ean ?? null,
        offer_sku: u.offer_sku ?? null,
        product_title: u.title ?? null,
        storefront: u.storefront ?? account.storefront,
        amount: Number(u.amount ?? 0),
        reserved_amount: Number(u.reserved_amount ?? 0),
        price: u.price != null ? Number(u.price) : null,
        status: u.status ?? null,
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

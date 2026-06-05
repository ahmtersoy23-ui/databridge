import logger from '../../config/logger';
import { walmartGet, type WalmartAccount } from './client';

/**
 * Walmart Items API (GET /v3/items) — satici-listing fiyatlari.
 * orders.ts ile ayni OAuth client + nextCursor pagination kalibi.
 * ItemReport_Walmart.csv'nin API karsiligi: sku + price + publishedStatus.
 */

interface WalmartItem {
  sku?: string;
  wpid?: string;
  upc?: string;
  gtin?: string;
  productName?: string;
  price?: { currency?: string; amount?: number };
  publishedStatus?: string;
  lifecycleStatus?: string;
}

interface ItemsResponse {
  ItemResponse?: WalmartItem[];
  totalItems?: number;
  nextCursor?: string;
}

export interface WalmartParsedItem {
  sku: string;
  price: number | null;
  currency: string;
  status: string | null;
  title: string | null;
  wpid: string | null;
  gtin: string | null;
}

function parseItem(item: WalmartItem): WalmartParsedItem | null {
  const sku = (item.sku || '').trim();
  if (!sku) return null;
  return {
    sku,
    price: typeof item.price?.amount === 'number' ? item.price.amount : null,
    currency: item.price?.currency || 'USD',
    status: item.publishedStatus || item.lifecycleStatus || null,
    title: item.productName || null,
    wpid: item.wpid || null,
    gtin: item.gtin || null,
  };
}

/**
 * Tum yayinlanmis item'lari nextCursor ile cek.
 */
export async function fetchAllItems(
  account: WalmartAccount,
  opts: { limit?: number; maxItems?: number } = {},
): Promise<WalmartParsedItem[]> {
  const limit = opts.limit ?? 200; // Walmart /v3/items max 200
  const maxItems = opts.maxItems ?? 50_000;

  const out: WalmartParsedItem[] = [];
  let cursor: string | undefined;
  let page = 0;

  while (true) {
    page++;
    let resp: ItemsResponse;
    if (cursor) {
      resp = await walmartGet<ItemsResponse>(account, '/v3/items', { cursor });
    } else {
      resp = await walmartGet<ItemsResponse>(account, '/v3/items', { params: { limit } });
    }

    const items = resp.ItemResponse ?? [];
    if (items.length === 0) break;

    for (const it of items) {
      const parsed = parseItem(it);
      if (parsed) out.push(parsed);
    }
    logger.info(`[Walmart] '${account.label}' items page ${page}: ${items.length} (total ${out.length})`);

    if (out.length >= maxItems) {
      logger.warn(`[Walmart] '${account.label}' hit maxItems=${maxItems}, stopping`);
      break;
    }

    cursor = resp.nextCursor;
    if (!cursor) break;
    if (cursor.startsWith('?')) cursor = cursor.slice(1);
  }

  logger.info(`[Walmart] '${account.label}' fetched ${out.length} items across ${page} pages`);
  return out;
}

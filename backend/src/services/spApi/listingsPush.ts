import type { SellingPartner } from 'amazon-sp-api';
import { getSpApiClient, getCredentialsById } from './client';
import { withRetry } from '../../utils/retry';
import logger from '../../config/logger';

/**
 * Amazon Listings Items API ile FBM available (fulfillment_availability.quantity) push.
 * Veeqo gibi: SP-API ile konusan TEK yer DataBridge; ManuMaestro hesabi yapip buraya
 * {sku, quantity} listesi gonderir. Diff-based: once getListingsItem ile mevcut adet
 * okunur, esitse PATCH atlanir (gereksiz cagri + risk yok). FBA'ya dokunulmaz —
 * cagiran sadece amazon_fbm SKU'lari gonderir.
 *
 * Yetki: app'te "Product Listing" rolu sart (2026-06-10'da acildi + propagation).
 */

const MARKETPLACE_BY_COUNTRY: Record<string, string> = {
  US: 'ATVPDKIKX0DER',
};

export interface PushItem {
  sku: string;
  quantity: number;
  /** Amazon handling time (lead_time_to_ship_max_days). null/undefined => gönderme (mevcut/Amazon default). */
  handlingDays?: number | null;
}

export interface PushResult {
  sku: string;
  status: 'pushed' | 'skipped' | 'dryrun' | 'failed';
  from?: number | null;
  to: number;
  error?: string;
}

interface ListingState {
  quantity: number | null;
  productType: string | null;
  exists: boolean;
}

async function getListingState(
  client: SellingPartner,
  sellerId: string,
  sku: string,
  marketplaceId: string,
): Promise<ListingState> {
  try {
    const r = (await client.callAPI({
      operation: 'getListingsItem',
      endpoint: 'listingsItems',
      path: { sellerId, sku },
      query: { marketplaceIds: [marketplaceId], includedData: ['summaries', 'fulfillmentAvailability'] },
    })) as {
      summaries?: Array<{ productType?: string }>;
      fulfillmentAvailability?: Array<{ fulfillmentChannelCode?: string; quantity?: number }>;
    };
    const productType = r?.summaries?.[0]?.productType ?? null;
    const fa = r?.fulfillmentAvailability;
    let quantity: number | null = null;
    if (Array.isArray(fa) && fa.length) {
      const def = fa.find((x) => x.fulfillmentChannelCode === 'DEFAULT') ?? fa[0];
      quantity = typeof def?.quantity === 'number' ? def.quantity : null;
    }
    return { quantity, productType, exists: true };
  } catch (err) {
    const msg = (err as { message?: string })?.message ?? '';
    if (/not found|NOT_FOUND|\b404\b/i.test(msg)) return { quantity: null, productType: null, exists: false };
    throw err;
  }
}

/**
 * SKU listesini hedef adetlere getir. Diff-based + dry-run destekli.
 * Sirali (rate-limit guvenli); cagiran tarafta degisen-set kucuk tutulur.
 */
export async function pushListingQuantities(
  credentialId: number,
  country: string,
  items: PushItem[],
  opts: { dryRun?: boolean } = {},
): Promise<PushResult[]> {
  const marketplaceId = MARKETPLACE_BY_COUNTRY[country.toUpperCase()];
  if (!marketplaceId) throw new Error(`Desteklenmeyen ulke: ${country}`);
  const creds = await getCredentialsById(credentialId);
  if (!creds?.seller_id) throw new Error(`cred ${credentialId} icin seller_id yok`);
  const sellerId = creds.seller_id;
  const client = await getSpApiClient(credentialId);

  const results: PushResult[] = [];
  for (const it of items) {
    try {
      const cur = await withRetry(() => getListingState(client, sellerId, it.sku, marketplaceId), {
        label: 'listings-get',
        maxRetries: 3,
        baseDelayMs: 2_000,
      });
      if (!cur.exists) {
        results.push({ sku: it.sku, status: 'failed', to: it.quantity, error: 'listing bulunamadi' });
        continue;
      }
      // handling verilmediyse ve adet aynıysa atla; handling verildiyse her zaman yaz (set et).
      if (cur.quantity === it.quantity && it.handlingDays == null) {
        results.push({ sku: it.sku, status: 'skipped', from: cur.quantity, to: it.quantity });
        continue;
      }
      if (opts.dryRun) {
        results.push({ sku: it.sku, status: 'dryrun', from: cur.quantity, to: it.quantity });
        continue;
      }
      if (!cur.productType) {
        results.push({ sku: it.sku, status: 'failed', from: cur.quantity, to: it.quantity, error: 'productType okunamadi' });
        continue;
      }
      await withRetry(
        () =>
          client.callAPI({
            operation: 'patchListingsItem',
            endpoint: 'listingsItems',
            path: { sellerId, sku: it.sku },
            query: { marketplaceIds: [marketplaceId] },
            body: {
              productType: cur.productType,
              patches: [
                {
                  op: 'replace',
                  path: '/attributes/fulfillment_availability',
                  value: [
                    {
                      fulfillment_channel_code: 'DEFAULT',
                      quantity: it.quantity,
                      // handling verildiyse bas (lead_time_to_ship_max_days); yoksa alanı hiç gönderme.
                      ...(it.handlingDays != null ? { lead_time_to_ship_max_days: it.handlingDays } : {}),
                    },
                  ],
                },
              ],
            },
          }),
        { label: 'listings-patch', maxRetries: 2, baseDelayMs: 3_000 },
      );
      results.push({ sku: it.sku, status: 'pushed', from: cur.quantity, to: it.quantity });
    } catch (err) {
      const error = ((err as { message?: string })?.message ?? String(err)).slice(0, 200);
      logger.warn(`[listingsPush] ${it.sku} basarisiz: ${error}`);
      results.push({ sku: it.sku, status: 'failed', to: it.quantity, error });
    }
  }
  return results;
}

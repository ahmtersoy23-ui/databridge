import { getSpApiClient, getSpApiClientByRegion } from './client';
import { waitForReport } from './reportUtils';
import logger from '../../config/logger';
import type { MarketplaceConfig } from '../../types';

/**
 * Amazon "All Listings" raporu (GET_MERCHANT_LISTINGS_ALL_DATA) — bizim kendi
 * listing fiyatlarimiz (seller-sku + asin + price + fulfillment-channel).
 * orders.ts ile ayni Reports API kalibi (createReport -> waitForReport -> download).
 * fulfillment-channel: 'DEFAULT' = FBM/MFN, 'AMAZON_*' (AFN) = FBA.
 */

export interface ListingRow {
  sku: string;
  asin: string | null;
  price: number | null;
  status: string | null;
  fulfillment: 'FBA' | 'FBM';
}

export async function fetchMerchantListings(marketplace: MarketplaceConfig): Promise<ListingRow[]> {
  const client = marketplace.credential_id
    ? await getSpApiClient(marketplace.credential_id)
    : await getSpApiClientByRegion(marketplace.region.toLowerCase());

  logger.info(`[SP-API] Requesting listings report for ${marketplace.country_code}`);

  const reportResponse: any = await client.callAPI({
    operation: 'createReport',
    endpoint: 'reports',
    body: {
      reportType: 'GET_MERCHANT_LISTINGS_ALL_DATA',
      marketplaceIds: [marketplace.marketplace_id],
    },
  });

  const reportId = reportResponse?.reportId;
  if (!reportId) throw new Error(`Failed to create listings report for ${marketplace.country_code}`);

  const document = await waitForReport(client, reportId);
  const reportData: any = await client.download(document, { json: true });

  const rows: ListingRow[] = [];
  if (!Array.isArray(reportData)) {
    logger.warn(`[SP-API] Listings report non-array for ${marketplace.country_code}`);
    return rows;
  }

  for (const row of reportData) {
    const sku = (row['seller-sku'] || row['sku'] || '').toString().trim();
    if (!sku) continue;
    // Giveaway SKU'lari atla (codebase kurali: sku NOT LIKE 'amzn.gr.%')
    if (/^amzn\.gr\./i.test(sku)) continue;
    // NOT: "Inactive" (out-of-stock) listing'ler de YAZILIR — status saklanir.
    // Fiyat kiyasi PriceLab tarafinda status<>'Inactive' ile filtrelenir; stok push
    // ise tukenmis FBM listing'lerine bas(ip yeniden ac)mak icin bunlara ihtiyac duyar.

    const priceRaw = row['price'];
    const price = priceRaw !== undefined && priceRaw !== '' ? parseFloat(priceRaw) : NaN;

    const fc = (row['fulfillment-channel'] || '').toString().toUpperCase();
    // DEFAULT = merchant (FBM); AMAZON_NA / AMAZON_* = Amazon-fulfilled (FBA)
    const fulfillment: 'FBA' | 'FBM' = fc.startsWith('AMAZON') ? 'FBA' : 'FBM';

    rows.push({
      sku,
      asin: (row['asin1'] || row['asin'] || '').toString().trim() || null,
      price: Number.isFinite(price) ? price : null,
      status: (row['status'] || '').toString() || null,
      fulfillment,
    });
  }

  logger.info(`[SP-API] Parsed ${rows.length} listings for ${marketplace.country_code}`);
  return rows;
}

import { SellingPartner } from 'amazon-sp-api';
import { getSpApiClient, getSpApiClientByRegion } from './client';
import logger from '../../config/logger';
import { SALES_CHANNEL_TO_CHANNEL, MARKETPLACE_TIMEZONE_OFFSETS } from '../../config/constants';
import type { MarketplaceConfig, RawOrder } from '../../types';

export async function fetchOrdersByDateRange(
  marketplace: MarketplaceConfig,
  startDate: Date,
  endDate: Date
): Promise<RawOrder[]> {
  const client = marketplace.credential_id
    ? await getSpApiClient(marketplace.credential_id)
    : await getSpApiClientByRegion(marketplace.region.toLowerCase());

  // Request the report
  logger.info(`[SP-API] Requesting orders report for ${marketplace.country_code}: ${startDate.toISOString()} - ${endDate.toISOString()}`);

  const reportResponse: any = await client.callAPI({
    operation: 'createReport',
    endpoint: 'reports',
    body: {
      reportType: 'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL',
      marketplaceIds: [marketplace.marketplace_id],
      dataStartTime: startDate.toISOString(),
      dataEndTime: endDate.toISOString(),
    },
  });

  const reportId = reportResponse?.reportId;
  if (!reportId) {
    throw new Error(`Failed to create report for ${marketplace.country_code}`);
  }

  // Poll for report completion
  const document = await waitForReport(client, reportId);

  // Download and parse the report
  const reportData: any = await client.download(document, { json: true });

  const orders: RawOrder[] = [];

  if (!Array.isArray(reportData)) {
    logger.warn(`[SP-API] Report returned non-array data for ${marketplace.country_code}`);
    return orders;
  }

  for (const row of reportData) {
    const purchaseDate = new Date(row['purchase-date'] || row['PurchaseDate']);
    if (isNaN(purchaseDate.getTime())) continue;

    // Resolve actual channel from sales-channel field (handles AE/SA sharing same report)
    const salesChannel = row['sales-channel'] || row['SalesChannel'] || '';
    const resolvedChannel = SALES_CHANNEL_TO_CHANNEL[salesChannel] || marketplace.channel;

    // Use resolved channel's timezone for local date conversion
    const tzOffset = MARKETPLACE_TIMEZONE_OFFSETS[resolvedChannel] ?? marketplace.timezone_offset;
    const localDate = toMarketplaceLocalDate(purchaseDate, tzOffset);

    const qty = parseInt(row['quantity'] || row['item-quantity'] || '0') || 0;
    if (qty === 0) continue;

    orders.push({
      marketplace_id: marketplace.marketplace_id,
      channel: resolvedChannel,
      amazon_order_id: row['amazon-order-id'] || row['AmazonOrderId'] || '',
      purchase_date: purchaseDate,
      purchase_date_local: localDate,
      sku: row['sku'] || row['seller-sku'] || '',
      asin: row['asin'] || '',
      iwasku: null, // Mapped later
      quantity: qty,
      item_price: parseFloat(row['item-price'] || row['item-total'] || '0') || 0,
      currency: row['currency'] || '',
      order_status: row['order-status'] || row['OrderStatus'] || '',
      fulfillment_channel: row['fulfillment-channel'] || row['FulfillmentChannel'] || '',
    });
  }

  logger.info(`[SP-API] Parsed ${orders.length} order items for ${marketplace.country_code}`);
  return orders;
}

async function waitForReport(client: SellingPartner, reportId: string, maxAttempts = 30): Promise<any> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const report: any = await client.callAPI({
      operation: 'getReport',
      endpoint: 'reports',
      path: { reportId },
    });

    const status = report?.processingStatus;

    if (status === 'DONE') {
      const docId = report.reportDocumentId;
      return client.callAPI({
        operation: 'getReportDocument',
        endpoint: 'reports',
        path: { reportDocumentId: docId },
      });
    }

    if (status === 'CANCELLED' || status === 'FATAL') {
      throw new Error(`Report ${reportId} failed with status: ${status}`);
    }

    // Wait before polling again (exponential backoff: 10s, 15s, 20s, ...)
    const waitMs = Math.min(10_000 + attempt * 5_000, 60_000);
    logger.debug(`[SP-API] Report ${reportId} status: ${status}, waiting ${waitMs}ms...`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }

  throw new Error(`Report ${reportId} timed out after ${maxAttempts} attempts`);
}

function toMarketplaceLocalDate(utcDate: Date, timezoneOffset: number): string {
  const localMs = utcDate.getTime() + timezoneOffset * 60 * 60 * 1000;
  const localDate = new Date(localMs);
  return localDate.toISOString().split('T')[0]; // YYYY-MM-DD
}

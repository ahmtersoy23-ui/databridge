import { getSpApiClient, getSpApiClientByRegion } from './client';
import { waitForReport } from './reportUtils';
import {
  categorizeTransactionType,
  detectFulfillment,
  detectMarketplaceCode,
  parseNumber,
  generateTransactionId,
  computeDateOnly,
} from './transactionParser';
import logger from '../../config/logger';
import type { MarketplaceConfig } from '../../types';
import type { FinancialTransaction } from '../../types';

/**
 * Fetch financial transaction report from SP-API for a single marketplace.
 * Unlike orders (credential-based), financial reports are per marketplace_id.
 */
export async function fetchTransactionsByDateRange(
  marketplace: MarketplaceConfig,
  startDate: Date,
  endDate: Date
): Promise<FinancialTransaction[]> {
  const client = marketplace.credential_id
    ? await getSpApiClient(marketplace.credential_id)
    : await getSpApiClientByRegion(marketplace.region.toLowerCase());

  logger.info(`[SP-API] Requesting transaction report for ${marketplace.country_code}: ${startDate.toISOString()} - ${endDate.toISOString()}`);

  const reportResponse: any = await client.callAPI({
    operation: 'createReport',
    endpoint: 'reports',
    body: {
      reportType: 'GET_DATE_RANGE_FINANCIAL_TRANSACTION_DATA' as any,
      marketplaceIds: [marketplace.marketplace_id],
      dataStartTime: startDate.toISOString(),
      dataEndTime: endDate.toISOString(),
    },
  });

  const reportId = reportResponse?.reportId;
  if (!reportId) {
    throw new Error(`Failed to create transaction report for ${marketplace.country_code}`);
  }

  const document = await waitForReport(client, reportId);
  const reportData: any = await client.download(document, { json: true });

  const transactions: FinancialTransaction[] = [];

  if (!Array.isArray(reportData)) {
    logger.warn(`[SP-API] Transaction report returned non-array data for ${marketplace.country_code}`);
    return transactions;
  }

  for (const row of reportData) {
    const rawDate = row['date/time'] || row['Date/Time'] || row['datetime'] || '';
    const parsedDate = new Date(rawDate);
    if (isNaN(parsedDate.getTime())) continue;

    const typeValue = row['type'] || row['Type'] || '';
    const categoryType = categorizeTransactionType(typeValue);
    if (!categoryType) continue; // Skip unclassifiable rows

    const marketplaceValue = row['marketplace'] || row['Marketplace'] || '';
    const marketplaceCode = detectMarketplaceCode(marketplaceValue) || marketplace.country_code;

    const fulfillmentValue = row['fulfillment'] || row['Fulfillment'] || row['fulfillment channel'] || '';
    const fulfillment = detectFulfillment(fulfillmentValue);

    const orderId = row['order id'] || row['Order ID'] || row['order-id'] || '';
    const sku = row['sku'] || row['SKU'] || '';
    const total = parseNumber(row['total'] || row['Total']);

    const transactionId = generateTransactionId(
      marketplaceCode, parsedDate, typeValue, orderId, sku, total
    );

    const dateOnly = computeDateOnly(parsedDate, marketplaceCode);

    // Liquidations: extract from total when category is Liquidations
    const isLiquidation = categoryType === 'Liquidations';

    transactions.push({
      transaction_id: transactionId,
      file_name: 'sp-api-sync',
      transaction_date: parsedDate,
      date_only: dateOnly,
      type: typeValue,
      category_type: categoryType,
      order_id: orderId,
      sku,
      description: row['description'] || row['Description'] || '',
      marketplace: marketplaceValue,
      marketplace_code: marketplaceCode,
      fulfillment,
      order_postal: row['order postal'] || row['Order Postal'] || row['order-postal'] || '',
      quantity: parseInt(row['quantity'] || row['Quantity'] || '0') || 0,
      product_sales: parseNumber(row['product sales'] || row['Product Sales']),
      promotional_rebates: parseNumber(row['promotional rebates'] || row['Promotional Rebates']),
      selling_fees: parseNumber(row['selling fees'] || row['Selling Fees']),
      fba_fees: parseNumber(row['fba fees'] || row['FBA Fees'] || row['fulfilment by amazon fees']),
      other_transaction_fees: parseNumber(row['other transaction fees'] || row['Other Transaction Fees']),
      other: parseNumber(row['other'] || row['Other']),
      vat: 0, // SP-API flat file does not include product sales tax column
      liquidations: isLiquidation ? total : 0,
      total,
      credential_id: marketplace.credential_id,
    });
  }

  logger.info(`[SP-API] Parsed ${transactions.length} transactions for ${marketplace.country_code}`);
  return transactions;
}

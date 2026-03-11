import { getSpApiClient, getSpApiClientByRegion } from './client';
import {
  detectMarketplaceCode,
  generateTransactionId,
  computeDateOnly,
} from './transactionParser';
import logger from '../../config/logger';
import type { MarketplaceConfig } from '../../types';
import type { FinancialTransaction } from '../../types';

/**
 * Fetch financial events via SP-API Finances API (listFinancialEvents).
 * Returns all marketplaces for the credential in one call.
 * Handles pagination via NextToken.
 */
export async function fetchTransactionsByDateRange(
  marketplace: MarketplaceConfig,
  startDate: Date,
  _endDate: Date
): Promise<FinancialTransaction[]> {
  const client = marketplace.credential_id
    ? await getSpApiClient(marketplace.credential_id)
    : await getSpApiClientByRegion(marketplace.region.toLowerCase());

  logger.info(`[SP-API] Fetching financial events for credential ${marketplace.credential_id} (${marketplace.country_code}): from ${startDate.toISOString()}`);

  const allTransactions: FinancialTransaction[] = [];
  let nextToken: string | undefined;
  let pageCount = 0;

  do {
    const query: Record<string, string> = {
      PostedAfter: startDate.toISOString(),
      MaxResultsPerPage: '100',
    };
    if (nextToken) query.NextToken = nextToken;

    const response: any = await client.callAPI({
      operation: 'listFinancialEvents',
      endpoint: 'finances',
      query,
    });

    const events = response?.FinancialEvents || response;
    const transactions = flattenFinancialEvents(events, marketplace.credential_id);
    allTransactions.push(...transactions);

    nextToken = response?.NextToken;
    pageCount++;

    if (pageCount % 10 === 0) {
      logger.info(`[SP-API] Financial events page ${pageCount}: ${allTransactions.length} transactions so far`);
    }

    // Rate limit: 0.5 RPS for listFinancialEvents
    if (nextToken) await new Promise(resolve => setTimeout(resolve, 500));
  } while (nextToken);

  logger.info(`[SP-API] Fetched ${allTransactions.length} financial transactions in ${pageCount} pages`);
  return allTransactions;
}

// --- Flatten structured events into flat AmzSellMetrics rows ---

function flattenFinancialEvents(events: any, credentialId: number | null): FinancialTransaction[] {
  const transactions: FinancialTransaction[] = [];
  if (!events) return transactions;

  if (Array.isArray(events.ShipmentEventList)) {
    for (const e of events.ShipmentEventList) transactions.push(...flattenShipmentEvent(e, 'Order', credentialId));
  }
  if (Array.isArray(events.RefundEventList)) {
    for (const e of events.RefundEventList) transactions.push(...flattenShipmentEvent(e, 'Refund', credentialId));
  }
  if (Array.isArray(events.AdjustmentEventList)) {
    for (const e of events.AdjustmentEventList) transactions.push(...flattenAdjustmentEvent(e, credentialId));
  }
  if (Array.isArray(events.ServiceFeeEventList)) {
    for (const e of events.ServiceFeeEventList) transactions.push(...flattenServiceFeeEvent(e, credentialId));
  }
  if (Array.isArray(events.SAFETReimbursementEventList)) {
    for (const e of events.SAFETReimbursementEventList) transactions.push(...flattenSafetEvent(e, credentialId));
  }
  if (Array.isArray(events.FBALiquidationEventList)) {
    for (const e of events.FBALiquidationEventList) transactions.push(...flattenLiquidationEvent(e, credentialId));
  }
  if (Array.isArray(events.CouponPaymentEventList)) {
    for (const e of events.CouponPaymentEventList) transactions.push(...flattenCouponEvent(e, credentialId));
  }
  if (Array.isArray(events.ChargeRefundEventList)) {
    for (const e of events.ChargeRefundEventList) transactions.push(...flattenShipmentEvent(e, 'Chargeback Refund', credentialId));
  }

  return transactions;
}

// --- Amount helpers ---

function getChargeAmount(list: any[], type: string): number {
  if (!Array.isArray(list)) return 0;
  return list.find((c: any) => c.ChargeType === type)?.ChargeAmount?.CurrencyAmount || 0;
}

function getFeeAmount(list: any[], type: string): number {
  if (!Array.isArray(list)) return 0;
  return list.find((f: any) => f.FeeType === type)?.FeeAmount?.CurrencyAmount || 0;
}

function sumFees(list: any[], exclude: string[] = []): number {
  if (!Array.isArray(list)) return 0;
  return list.filter((f: any) => !exclude.includes(f.FeeType))
    .reduce((s: number, f: any) => s + (f.FeeAmount?.CurrencyAmount || 0), 0);
}

function sumCharges(list: any[]): number {
  if (!Array.isArray(list)) return 0;
  return list.reduce((s: number, c: any) => s + (c.ChargeAmount?.CurrencyAmount || 0), 0);
}

function sumPromotions(list: any[]): number {
  if (!Array.isArray(list)) return 0;
  return list.reduce((s: number, p: any) => s + (p.PromotionAmount?.CurrencyAmount || 0), 0);
}

function sumTaxWithheld(list: any[]): number {
  if (!Array.isArray(list)) return 0;
  let total = 0;
  for (const tw of list) {
    if (Array.isArray(tw.TaxesWithheld)) {
      for (const t of tw.TaxesWithheld) total += t.ChargeAmount?.CurrencyAmount || 0;
    }
  }
  return total;
}

// --- Event type flatteners ---

function flattenShipmentEvent(event: any, categoryType: string, credentialId: number | null): FinancialTransaction[] {
  const transactions: FinancialTransaction[] = [];
  const postedDate = event.PostedDate ? new Date(event.PostedDate) : null;
  if (!postedDate || isNaN(postedDate.getTime())) return transactions;

  const orderId = event.AmazonOrderId || '';
  const marketplaceValue = event.MarketplaceName || '';
  const marketplaceCode = detectMarketplaceCode(marketplaceValue);

  // Orders use ShipmentItemList; Refunds use ShipmentItemAdjustmentList
  const itemList = event.ShipmentItemList?.length > 0
    ? event.ShipmentItemList
    : event.ShipmentItemAdjustmentList || [];

  for (const item of itemList) {
    const sku = item.SellerSKU || '';
    const quantity = item.QuantityShipped || 0;

    // Orders use ItemChargeList/ItemFeeList; Refunds use *AdjustmentList variants
    const charges = item.ItemChargeList || item.ItemChargeAdjustmentList || [];
    const fees = item.ItemFeeList || item.ItemFeeAdjustmentList || [];
    const promos = item.PromotionList || item.PromotionAdjustmentList || [];

    const productSales = getChargeAmount(charges, 'Principal');
    const tax = getChargeAmount(charges, 'Tax');
    const shippingCharge = getChargeAmount(charges, 'ShippingCharge');
    const shippingTax = getChargeAmount(charges, 'ShippingTax');

    const commission = getFeeAmount(fees, 'Commission');
    const fbaPerUnit = getFeeAmount(fees, 'FBAPerUnitFulfillmentFee');
    const fbaPerOrder = getFeeAmount(fees, 'FBAPerOrderFulfillmentFee');
    const fbaWeightBased = getFeeAmount(fees, 'FBAWeightBasedFee');
    const fbaFees = fbaPerUnit + fbaPerOrder + fbaWeightBased;
    const sellingFees = commission;
    const otherFees = sumFees(fees, [
      'Commission', 'FBAPerUnitFulfillmentFee', 'FBAPerOrderFulfillmentFee', 'FBAWeightBasedFee',
    ]);

    const promotionalRebates = sumPromotions(promos);
    const vat = sumTaxWithheld(item.ItemTaxWithheldList);
    const fulfillment = fbaFees !== 0 ? 'FBA' : 'FBM';

    const total = productSales + tax + shippingCharge + shippingTax +
      sellingFees + fbaFees + otherFees + promotionalRebates;

    const transactionId = generateTransactionId(marketplaceCode, postedDate, categoryType, orderId, sku, total);
    const dateOnly = computeDateOnly(postedDate, marketplaceCode);

    transactions.push({
      transaction_id: transactionId,
      file_name: 'sp-api-sync',
      transaction_date: postedDate,
      date_only: dateOnly,
      type: categoryType,
      category_type: categoryType,
      order_id: orderId,
      sku,
      description: '',
      marketplace: marketplaceValue,
      marketplace_code: marketplaceCode,
      fulfillment,
      order_postal: '',
      quantity,
      product_sales: productSales,
      promotional_rebates: promotionalRebates,
      selling_fees: sellingFees,
      fba_fees: fbaFees,
      other_transaction_fees: otherFees,
      other: shippingCharge + shippingTax,
      vat,
      liquidations: 0,
      total,
      credential_id: credentialId,
    });
  }

  return transactions;
}

function flattenAdjustmentEvent(event: any, credentialId: number | null): FinancialTransaction[] {
  const transactions: FinancialTransaction[] = [];
  const postedDate = event.PostedDate ? new Date(event.PostedDate) : null;
  if (!postedDate || isNaN(postedDate.getTime())) return transactions;

  const adjustmentType = event.AdjustmentType || 'Adjustment';

  for (const item of (event.AdjustmentItemList || [])) {
    const total = item.TotalAmount?.CurrencyAmount || 0;
    const sku = item.SellerSKU || item.ASIN || '';
    const orderId = item.OrderId || '';

    const transactionId = generateTransactionId('', postedDate, adjustmentType, orderId, sku, total);
    const dateOnly = computeDateOnly(postedDate, '');

    transactions.push({
      transaction_id: transactionId, file_name: 'sp-api-sync',
      transaction_date: postedDate, date_only: dateOnly,
      type: adjustmentType, category_type: 'Adjustment',
      order_id: orderId, sku, description: adjustmentType,
      marketplace: '', marketplace_code: '', fulfillment: 'Unknown', order_postal: '',
      quantity: item.Quantity || 0,
      product_sales: 0, promotional_rebates: 0, selling_fees: 0,
      fba_fees: 0, other_transaction_fees: 0, other: total,
      vat: 0, liquidations: 0, total,
      credential_id: credentialId,
    });
  }

  return transactions;
}

function flattenServiceFeeEvent(event: any, credentialId: number | null): FinancialTransaction[] {
  const totalFee = (event.FeeList || []).reduce((s: number, f: any) => s + (f.FeeAmount?.CurrencyAmount || 0), 0);
  const feeReason = event.FeeReason || 'Service Fee';
  const postedDate = event.PostedDate ? new Date(event.PostedDate) : new Date();

  const transactionId = generateTransactionId('', postedDate, feeReason, event.AmazonOrderId || '', event.SellerSKU || '', totalFee);
  const dateOnly = computeDateOnly(postedDate, '');

  return [{
    transaction_id: transactionId, file_name: 'sp-api-sync',
    transaction_date: postedDate, date_only: dateOnly,
    type: feeReason, category_type: 'Service Fee',
    order_id: event.AmazonOrderId || '', sku: event.SellerSKU || '',
    description: event.FeeDescription || feeReason,
    marketplace: '', marketplace_code: '', fulfillment: 'Unknown', order_postal: '',
    quantity: 0,
    product_sales: 0, promotional_rebates: 0, selling_fees: 0,
    fba_fees: 0, other_transaction_fees: totalFee, other: 0,
    vat: 0, liquidations: 0, total: totalFee,
    credential_id: credentialId,
  }];
}

function flattenSafetEvent(event: any, credentialId: number | null): FinancialTransaction[] {
  const transactions: FinancialTransaction[] = [];
  const postedDate = event.PostedDate ? new Date(event.PostedDate) : null;
  if (!postedDate || isNaN(postedDate.getTime())) return transactions;

  const reasonCode = event.ReasonCode || 'SAFE-T';

  for (const item of (event.SAFETReimbursementItemList || [])) {
    const total = sumCharges(item.ItemChargeList || []);
    const transactionId = generateTransactionId('', postedDate, 'SAFE-T Reimbursement', event.SAFETClaimId || '', item.SellerSKU || '', total);
    const dateOnly = computeDateOnly(postedDate, '');

    transactions.push({
      transaction_id: transactionId, file_name: 'sp-api-sync',
      transaction_date: postedDate, date_only: dateOnly,
      type: `SAFE-T Reimbursement - ${reasonCode}`, category_type: 'SAFE-T Reimbursement',
      order_id: event.SAFETClaimId || '', sku: item.SellerSKU || '', description: reasonCode,
      marketplace: '', marketplace_code: '', fulfillment: 'FBA', order_postal: '',
      quantity: item.Quantity || 0,
      product_sales: 0, promotional_rebates: 0, selling_fees: 0,
      fba_fees: 0, other_transaction_fees: 0, other: total,
      vat: 0, liquidations: 0, total,
      credential_id: credentialId,
    });
  }

  return transactions;
}

function flattenLiquidationEvent(event: any, credentialId: number | null): FinancialTransaction[] {
  const postedDate = event.PostedDate ? new Date(event.PostedDate) : null;
  if (!postedDate || isNaN(postedDate.getTime())) return [];

  const proceeds = event.LiquidationProceedAmount?.CurrencyAmount || 0;
  const fee = event.LiquidationFeeAmount?.CurrencyAmount || 0;
  const total = proceeds + fee;

  const transactionId = generateTransactionId('', postedDate, 'Liquidations', event.AmazonOrderId || '', event.OriginalRemovalOrderId || '', total);
  const dateOnly = computeDateOnly(postedDate, '');

  return [{
    transaction_id: transactionId, file_name: 'sp-api-sync',
    transaction_date: postedDate, date_only: dateOnly,
    type: 'Liquidations', category_type: 'Liquidations',
    order_id: event.AmazonOrderId || '', sku: '',
    description: `Removal: ${event.OriginalRemovalOrderId || ''}`,
    marketplace: '', marketplace_code: '', fulfillment: 'FBA', order_postal: '',
    quantity: 0,
    product_sales: 0, promotional_rebates: 0, selling_fees: 0,
    fba_fees: fee, other_transaction_fees: 0, other: 0,
    vat: 0, liquidations: proceeds, total,
    credential_id: credentialId,
  }];
}

function flattenCouponEvent(event: any, credentialId: number | null): FinancialTransaction[] {
  const postedDate = event.PostedDate ? new Date(event.PostedDate) : null;
  if (!postedDate || isNaN(postedDate.getTime())) return [];

  const value = event.CouponValueAmount?.CurrencyAmount || 0;
  const fee = event.ClipOrRedemptionFeeAmount?.CurrencyAmount || 0;
  const total = value + fee;

  const transactionId = generateTransactionId('', postedDate, 'Coupon', event.CouponId || '', '', total);
  const dateOnly = computeDateOnly(postedDate, '');

  return [{
    transaction_id: transactionId, file_name: 'sp-api-sync',
    transaction_date: postedDate, date_only: dateOnly,
    type: 'Coupon Payment', category_type: 'Adjustment',
    order_id: '', sku: '', description: event.SellerCouponDescription || 'Coupon',
    marketplace: '', marketplace_code: '', fulfillment: 'Unknown', order_postal: '',
    quantity: event.TotalRedemptionCount || 0,
    product_sales: 0, promotional_rebates: value, selling_fees: 0,
    fba_fees: 0, other_transaction_fees: fee, other: 0,
    vat: 0, liquidations: 0, total,
    credential_id: credentialId,
  }];
}

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
 * Finances API v2024-06-19 listTransactions wrapper.
 * Returns RELEASED + DEFERRED + DEFERRED_RELEASED transactions for the credential.
 * Replaces the v0 listFinancialEvents path which stopped including DD+7 deferred
 * shipments after Amazon's 2026-04 transaction-level reserve rollout.
 */
export async function fetchTransactionsV2024(
  marketplace: MarketplaceConfig,
  startDate: Date,
  endDate: Date,
  marketplaceId?: string
): Promise<FinancialTransaction[]> {
  const client = marketplace.credential_id
    ? await getSpApiClient(marketplace.credential_id)
    : await getSpApiClientByRegion(marketplace.region.toLowerCase());

  logger.info(`[SP-API v2024] listTransactions cred=${marketplace.credential_id} ${startDate.toISOString()} → ${endDate.toISOString()}${marketplaceId ? ' marketplace=' + marketplaceId : ''}`);

  const allRows: FinancialTransaction[] = [];
  let nextToken: string | undefined;
  let pageCount = 0;
  const statusBreakdown: Record<string, number> = {};

  do {
    pageCount++;
    const query: Record<string, string> = {
      postedAfter: startDate.toISOString(),
      postedBefore: endDate.toISOString(),
    };
    if (marketplaceId) query.marketplaceId = marketplaceId;
    if (nextToken) query.nextToken = nextToken;

    const response: any = await (client as any).callAPI({
      operation: 'listTransactions',
      endpoint: 'finances',
      query,
    });

    const txList = response?.transactions || [];
    for (const tx of txList) {
      const status = tx.transactionStatus || 'UNKNOWN';
      statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
      allRows.push(...flattenTransactionV2024(tx, marketplace.credential_id));
    }

    nextToken = response?.nextToken;
    if (nextToken) await new Promise(r => setTimeout(r, 600));
  } while (nextToken && pageCount < 200);

  logger.info(`[SP-API v2024] cred=${marketplace.credential_id}: ${allRows.length} rows in ${pageCount} pages, status=${JSON.stringify(statusBreakdown)}`);
  return allRows;
}

// --- Mapping ---

const TRANSACTION_TYPE_TO_CATEGORY: Record<string, string> = {
  Shipment: 'Order',
  Refund: 'Refund',
  ServiceFee: 'Service Fee',
  ProductAdsPayment: 'Service Fee',
  Adjustment: 'Adjustment',
  FBAInventoryReimbursement: 'Adjustment',
  Retrocharge: 'Others',
  Transfer: 'Others',
};

interface BreakdownLeaf {
  type: string;
  amount: number;
  path: string[];
}

function collectLeaves(
  arr: any[],
  out: BreakdownLeaf[],
  path: string[] = []
): void {
  if (!Array.isArray(arr)) return;
  for (const b of arr) {
    const t = b.breakdownType || 'Unknown';
    const newPath = [...path, t];
    const children = b.breakdowns;
    if (Array.isArray(children) && children.length > 0) {
      collectLeaves(children, out, newPath);
    } else {
      out.push({
        type: t,
        amount: b.breakdownAmount?.currencyAmount || 0,
        path: newPath,
      });
    }
  }
}

interface MoneyBuckets {
  product_sales: number;
  promotional_rebates: number;
  selling_fees: number;
  fba_fees: number;
  other_transaction_fees: number;
  other: number;
  vat: number;
  liquidations: number;
}

function emptyBuckets(): MoneyBuckets {
  return {
    product_sales: 0,
    promotional_rebates: 0,
    selling_fees: 0,
    fba_fees: 0,
    other_transaction_fees: 0,
    other: 0,
    vat: 0,
    liquidations: 0,
  };
}

/**
 * Bucket a leaf breakdown into a v0-compatible field.
 * `path` is the chain of breakdownTypes from top → leaf, e.g.
 *   ['AmazonFees', 'FBAPerUnitFulfillmentFee', 'Base'] → fba_fees
 *   ['AmazonFees', 'Commission', 'Base'] → selling_fees
 *   ['Tax', 'MarketplaceFacilitatorTax-Principal'] → vat
 *   ['Tax', 'OurPriceTax'] → other
 *   ['ProductCharges', 'OurPricePrincipal'] → product_sales
 */
function bucketize(leaf: BreakdownLeaf, buckets: MoneyBuckets): void {
  const path = leaf.path;
  const inPath = (s: string) => path.includes(s);
  const matchInPath = (re: RegExp) => path.some(p => re.test(p));
  const amount = leaf.amount;

  // VAT — marketplace facilitator (withheld) or tax withheld charges
  if (matchInPath(/MarketplaceFacilitator|TaxWithheld/i)) {
    buckets.vat += amount;
    return;
  }

  // FBA fulfillment fees (PerUnit, PerOrder, WeightBased)
  if (matchInPath(/^FBA(PerUnit|PerOrder|WeightBased)?FulfillmentFee$/)) {
    buckets.fba_fees += amount;
    return;
  }

  // Commission / selling fees
  if (inPath('Commission')) {
    buckets.selling_fees += amount;
    return;
  }

  // Principal product revenue (sales)
  if (matchInPath(/^(OurPrice)?Principal$/) || inPath('ProductCharges') && !matchInPath(/Tax|Shipping|Promotion/i)) {
    buckets.product_sales += amount;
    return;
  }

  // Promotional rebates
  if (matchInPath(/Promotion/i)) {
    buckets.promotional_rebates += amount;
    return;
  }

  // Tax (non-withheld) & shipping → "other"
  if (matchInPath(/Tax|Shipping/i)) {
    buckets.other += amount;
    return;
  }

  // Liquidation
  if (matchInPath(/Liquidation/i)) {
    buckets.liquidations += amount;
    return;
  }

  // Anything else under Expenses (AmazonFees, FBAFees subtree)
  if (inPath('AmazonFees') || inPath('FBAFees') || inPath('Expenses')) {
    buckets.other_transaction_fees += amount;
    return;
  }

  // Default fallback
  buckets.other_transaction_fees += amount;
}

function findIdentifier(
  list: any[] | undefined,
  name: string,
  nameField = 'relatedIdentifierName',
  valueField = 'relatedIdentifierValue'
): string {
  if (!Array.isArray(list)) return '';
  const found = list.find((id: any) => id[nameField] === name);
  return found ? String(found[valueField] || '') : '';
}

function getProductContext(item: any): { sku: string; asin: string; quantity: number; fulfillment: string } {
  const ctx = (item.contexts || []).find((c: any) => c.contextType === 'ProductContext');
  if (!ctx) return { sku: '', asin: '', quantity: 0, fulfillment: 'Unknown' };
  const fn = ctx.fulfillmentNetwork;
  const fulfillment = fn === 'AFN' ? 'FBA' : fn === 'MFN' ? 'FBM' : 'Unknown';
  return {
    sku: ctx.sku || '',
    asin: ctx.asin || '',
    quantity: ctx.quantityShipped || 0,
    fulfillment,
  };
}

function getDeferredContext(tx: any): { status: string; deferralReason: string | null; maturityDate: Date | null } {
  const status = tx.transactionStatus || 'RELEASED';
  const ctx = (tx.contexts || []).find((c: any) => c.contextType === 'DeferredContext');
  if (!ctx) return { status, deferralReason: null, maturityDate: null };
  return {
    status,
    deferralReason: ctx.deferralReason || null,
    maturityDate: ctx.maturityDate ? new Date(ctx.maturityDate) : null,
  };
}

/**
 * Flatten one v2024 Transaction into one or more FinancialTransaction rows.
 * - Shipment / Refund / ProductAdsPayment / FBAInventoryReimbursement / Adjustment → one row per item
 * - ServiceFee / Transfer (no items) → one row from tx-level
 */
export function flattenTransactionV2024(tx: any, credentialId: number | null): FinancialTransaction[] {
  const txType = tx.transactionType || 'Unknown';
  const categoryType = TRANSACTION_TYPE_TO_CATEGORY[txType] || 'Others';

  const postedDate = tx.postedDate ? new Date(tx.postedDate) : null;
  if (!postedDate || isNaN(postedDate.getTime())) return [];

  const orderId = findIdentifier(tx.relatedIdentifiers, 'ORDER_ID')
    || findIdentifier(tx.relatedIdentifiers, 'REFUND_ID');
  const settlementId = findIdentifier(tx.relatedIdentifiers, 'SETTLEMENT_ID');
  const marketplaceId = tx.marketplaceDetails?.marketplaceId || '';
  const marketplaceName = tx.marketplaceDetails?.marketplaceName || '';
  const marketplaceCode = detectMarketplaceCode(marketplaceName) || marketplaceFromId(marketplaceId);

  const deferred = getDeferredContext(tx);

  const items: any[] = Array.isArray(tx.items) && tx.items.length > 0 ? tx.items : [];

  if (items.length === 0) {
    // tx-level row (ServiceFee, Transfer, etc.)
    const buckets = emptyBuckets();
    const leaves: BreakdownLeaf[] = [];
    collectLeaves(tx.breakdowns || [], leaves);
    for (const lf of leaves) bucketize(lf, buckets);

    const total = tx.totalAmount?.currencyAmount || 0;
    const description = tx.description || txType;
    const fulfillment = inferFulfillmentFromBuckets(buckets);

    const transactionId = generateTransactionId(
      marketplaceCode, postedDate, categoryType,
      orderId || settlementId, '', total
    );

    return [{
      transaction_id: transactionId,
      file_name: 'sp-api-v2024',
      transaction_date: postedDate,
      date_only: computeDateOnly(postedDate, marketplaceCode),
      type: txType,
      category_type: categoryType,
      order_id: orderId,
      sku: '',
      description,
      marketplace: marketplaceName,
      marketplace_code: marketplaceCode,
      fulfillment,
      order_postal: '',
      quantity: 0,
      ...buckets,
      total,
      credential_id: credentialId,
      transaction_status: deferred.status,
      maturity_date: deferred.maturityDate,
      deferral_reason: deferred.deferralReason,
    }];
  }

  // per-item rows
  const rows: FinancialTransaction[] = [];
  for (const item of items) {
    const buckets = emptyBuckets();
    const leaves: BreakdownLeaf[] = [];
    collectLeaves(item.breakdowns || [], leaves);
    for (const lf of leaves) bucketize(lf, buckets);

    const product = getProductContext(item);
    const itemTotal = item.totalAmount?.currencyAmount || 0;
    const description = item.description || tx.description || txType;
    const fulfillment = product.fulfillment !== 'Unknown'
      ? product.fulfillment
      : inferFulfillmentFromBuckets(buckets);

    const transactionId = generateTransactionId(
      marketplaceCode, postedDate, categoryType,
      orderId, product.sku, itemTotal
    );

    rows.push({
      transaction_id: transactionId,
      file_name: 'sp-api-v2024',
      transaction_date: postedDate,
      date_only: computeDateOnly(postedDate, marketplaceCode),
      type: txType,
      category_type: categoryType,
      order_id: orderId,
      sku: product.sku,
      description,
      marketplace: marketplaceName,
      marketplace_code: marketplaceCode,
      fulfillment,
      order_postal: '',
      quantity: product.quantity,
      ...buckets,
      total: itemTotal,
      credential_id: credentialId,
      transaction_status: deferred.status,
      maturity_date: deferred.maturityDate,
      deferral_reason: deferred.deferralReason,
    });
  }

  return rows;
}

function inferFulfillmentFromBuckets(b: MoneyBuckets): string {
  return b.fba_fees !== 0 ? 'FBA' : 'FBM';
}

function marketplaceFromId(mpId: string): string {
  switch (mpId) {
    case 'ATVPDKIKX0DER': return 'US';
    case 'A2EUQ1WTGCTBG2': return 'CA';
    case 'A1AM78C64UM0Y8': return 'MX';
    case 'A1F83G8C2ARO7P': return 'UK';
    case 'A1PA6795UKMFR9': return 'DE';
    case 'A13V1IB3VIYZZH': return 'FR';
    case 'APJ6JRA9NG5V4':  return 'IT';
    case 'A1RKKUPIHCS9HS': return 'ES';
    case 'A1805IZSGTT6HS': return 'NL';
    case 'A1C3SOZRARQ6R3': return 'PL';
    case 'A2NODRKZP88ZB9': return 'SE';
    case 'A39IBJ37TRP1C6': return 'AU';
    case 'A2VIGQ35RCS4UG': return 'AE';
    case 'A17E79C6D8DWNP': return 'SA';
    case 'A1VC38T7YXB528': return 'JP';
    case 'A19VAU5U5O7RUS': return 'SG';
    case 'A21TJRUUN4KGV':  return 'IN';
    case 'A33AVAJ2PDY3EV': return 'TR';
    default: return '';
  }
}

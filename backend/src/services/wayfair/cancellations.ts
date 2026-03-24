import { graphqlQuery, getApiBase, type WayfairAccount } from './client';
import logger from '../../config/logger';

export interface CancellationRecord {
  poNumber: string;
  partNumber: string;
  status: string;
  reason: string;
  requestedAt: string;
}

const CANCEL_QUERY = `
  query($input: LineItemCancellationRequestByPurchaseOrdersInput!) {
    lineItemCancellationRequestByPurchaseOrders(poInput: $input) {
      status
      requestedAt
      cancellationReason { reason }
      purchaseOrder { poNumber }
      cancelledProduct { partNumber }
    }
  }
`;

interface CancelResponse {
  lineItemCancellationRequestByPurchaseOrders: Array<{
    status: string;
    requestedAt: string;
    cancellationReason: { reason: string } | null;
    purchaseOrder: { poNumber: string };
    cancelledProduct: { partNumber: string };
  }>;
}

/**
 * Query cancellation records for a batch of PO numbers.
 * Uses api.wayfair.io (supplier-order-api), NOT api.wayfair.com.
 * Returns a Set of "poNumber|partNumber" keys that are cancelled.
 */
export async function fetchCancellations(
  account: WayfairAccount,
  poNumbers: string[]
): Promise<Set<string>> {
  if (poNumbers.length === 0) return new Set();

  const endpoint = getApiBase(account.use_sandbox);
  const cancelledKeys = new Set<string>();

  // Batch in chunks of 200 PO numbers
  const CHUNK = 200;
  for (let i = 0; i < poNumbers.length; i += CHUNK) {
    const chunk = poNumbers.slice(i, i + CHUNK);
    try {
      const result = await graphqlQuery<CancelResponse>(
        account,
        CANCEL_QUERY,
        { input: { poNumbers: chunk } },
        endpoint
      );

      for (const rec of result.lineItemCancellationRequestByPurchaseOrders || []) {
        if (rec.status === 'CANCELLED') {
          cancelledKeys.add(`${rec.purchaseOrder.poNumber}|${rec.cancelledProduct.partNumber}`);
        }
      }
    } catch (err: any) {
      logger.warn(`[Wayfair Cancel][${account.label}] Cancellation check failed (non-fatal): ${err.message}`);
      break;
    }
  }

  if (cancelledKeys.size > 0) {
    logger.info(`[Wayfair Cancel][${account.label}] ${cancelledKeys.size} cancelled line items found`);
  }

  return cancelledKeys;
}

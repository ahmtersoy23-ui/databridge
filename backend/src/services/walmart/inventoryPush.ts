import { getActiveAccounts, walmartGet, walmartPut } from './client';
import { withRetry } from '../../utils/retry';
import logger from '../../config/logger';

/**
 * Walmart Inventory API ile stok push. Amazon listingsPush ile aynı kalıp:
 * GET /v3/inventory?sku → mevcut adet; eşitse PUT atla (diff); değilse
 * PUT /v3/inventory body {sku, quantity:{unit:'EACH', amount}}.
 * Tek US hesabı (getActiveAccounts[0]). WFS ürünlerine push edilmez — çağıran
 * sadece seller-fulfilled PUBLISHED SKU gönderir.
 */

export interface WmPushItem {
  sku: string;
  quantity: number;
}

export interface WmPushResult {
  sku: string;
  status: 'pushed' | 'skipped' | 'dryrun' | 'failed';
  from?: number | null;
  to: number;
  error?: string;
}

interface InvResp {
  sku?: string;
  quantity?: { unit?: string; amount?: number };
}

export async function pushWalmartInventory(
  items: WmPushItem[],
  opts: { dryRun?: boolean } = {},
): Promise<WmPushResult[]> {
  const accounts = await getActiveAccounts();
  if (!accounts.length) throw new Error('aktif Walmart hesabı yok');
  const account = accounts[0]; // tek US hesabı (us-main)

  const results: WmPushResult[] = [];
  for (const it of items) {
    try {
      const cur = await withRetry(
        () => walmartGet<InvResp>(account, '/v3/inventory', { params: { sku: it.sku } }),
        { label: 'wm-inv-get', maxRetries: 3, baseDelayMs: 2_000 },
      );
      const current = typeof cur?.quantity?.amount === 'number' ? cur.quantity.amount : null;
      if (current === it.quantity) {
        results.push({ sku: it.sku, status: 'skipped', from: current, to: it.quantity });
        continue;
      }
      if (opts.dryRun) {
        results.push({ sku: it.sku, status: 'dryrun', from: current, to: it.quantity });
        continue;
      }
      await withRetry(
        () =>
          walmartPut(
            account,
            '/v3/inventory',
            { sku: it.sku, quantity: { unit: 'EACH', amount: it.quantity } },
            { params: { sku: it.sku } },
          ),
        { label: 'wm-inv-put', maxRetries: 2, baseDelayMs: 3_000 },
      );
      results.push({ sku: it.sku, status: 'pushed', from: current, to: it.quantity });
    } catch (err) {
      const error = ((err as { message?: string })?.message ?? String(err)).slice(0, 200);
      logger.warn(`[walmartInvPush] ${it.sku} basarisiz: ${error}`);
      results.push({ sku: it.sku, status: 'failed', to: it.quantity, error });
    }
  }
  return results;
}

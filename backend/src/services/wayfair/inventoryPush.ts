import { graphqlQuery, getSupplierId, getDropshipApiBase, type WayfairAccount } from './client';
import { withRetry } from '../../utils/retry';
import logger from '../../config/logger';

/**
 * Wayfair dropship stok push — inventory.save mutation (dropship endpoint /v1/graphql).
 * Amazon/Walmart push ile aynı dış sözleşme: çağıran {sku, quantity} gönderir,
 * sku = supplierPartNumber (suPartNum). Burada inventoryInput'a çevrilir.
 *
 * Diff ManuMaestro tarafında stock_push_state ile yapılır → DataBridge sadece
 * verilen kalemleri kaydeder. feedKind:
 *   DIFFERENTIAL → sadece değişenler (varsayılan, ~30dk near-real-time)
 *   TRUE_UP      → tam liste (günlük reconcile; eksik part'ları Wayfair 0'lar)
 * dryRun:true → kaydetmeden doğrular (handle döner, güvenli).
 * Stok supplier seviyesinde (warehouse alanı yok) — quantityOnHand = toplam US availability.
 */

export interface WfPushItem {
  sku: string; // supplierPartNumber
  quantity: number;
}

export interface WfPushResult {
  sku: string;
  status: 'pushed' | 'dryrun' | 'failed';
  to: number;
  error?: string;
}

export type WayfairFeedKind = 'DIFFERENTIAL' | 'TRUE_UP';

const SAVE_MUTATION = `
  mutation save($inventory: [inventoryInput]!, $feedKind: inventoryFeedKind, $dryRun: Boolean) {
    inventory {
      save(inventory: $inventory, feedKind: $feedKind, dryRun: $dryRun) { handle }
    }
  }
`;

const CHUNK = 200;

export async function pushWayfairInventory(
  account: WayfairAccount,
  items: WfPushItem[],
  opts: { dryRun?: boolean; feedKind?: WayfairFeedKind } = {},
): Promise<WfPushResult[]> {
  const supplierId = await getSupplierId(account);
  const endpoint = getDropshipApiBase(account.use_sandbox);
  const feedKind: WayfairFeedKind = opts.feedKind ?? 'DIFFERENTIAL';
  const dryRun = !!opts.dryRun;

  const results: WfPushResult[] = [];
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const inventory = chunk.map((it) => ({
      supplierId,
      supplierPartNumber: it.sku,
      quantityOnHand: it.quantity,
    }));
    try {
      await withRetry(
        () =>
          graphqlQuery(account, SAVE_MUTATION, { inventory, feedKind, dryRun }, endpoint),
        { label: dryRun ? 'wf-inv-save-dry' : 'wf-inv-save', maxRetries: dryRun ? 3 : 2, baseDelayMs: 3_000 },
      );
      const status: WfPushResult['status'] = dryRun ? 'dryrun' : 'pushed';
      for (const it of chunk) results.push({ sku: it.sku, status, to: it.quantity });
    } catch (err) {
      const error = ((err as { message?: string })?.message ?? String(err)).slice(0, 200);
      logger.warn(`[wayfairInvPush][${account.label}] chunk ${i}-${i + chunk.length} basarisiz: ${error}`);
      for (const it of chunk) results.push({ sku: it.sku, status: 'failed', to: it.quantity, error });
    }
  }
  return results;
}

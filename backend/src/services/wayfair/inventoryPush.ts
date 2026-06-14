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
  /** Çok-depolu: hedef ship-node supplierId. Verilmezse hesabın supplier'ı (getSupplierId). */
  supplierId?: number;
}

export interface WfPushResult {
  sku: string;
  status: 'pushed' | 'dryrun' | 'failed';
  to: number;
  error?: string;
  /** Bu sonucun yazıldığı supplierId (çağıran state'i doğru node'a yazsın). */
  supplierId: number;
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
  const accountSupplierId = await getSupplierId(account);
  const endpoint = getDropshipApiBase(account.use_sandbox);
  const feedKind: WayfairFeedKind = opts.feedKind ?? 'DIFFERENTIAL';
  const dryRun = !!opts.dryRun;

  // Çok-depolu (node-bazlı): item'lar farklı supplierId taşıyabilir (218846/502337). supplierId
  // başına grupla, her grup için ayrı inventory.save (Wayfair'de depo = supplierId; warehouseId yok).
  const groups = new Map<number, WfPushItem[]>();
  for (const it of items) {
    const sid = it.supplierId ?? accountSupplierId;
    const g = groups.get(sid);
    if (g) g.push(it); else groups.set(sid, [it]);
  }

  const results: WfPushResult[] = [];
  for (const [supplierId, groupItems] of groups) {
    for (let i = 0; i < groupItems.length; i += CHUNK) {
      const chunk = groupItems.slice(i, i + CHUNK);
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
        for (const it of chunk) results.push({ sku: it.sku, status, to: it.quantity, supplierId });
      } catch (err) {
        const error = ((err as { message?: string })?.message ?? String(err)).slice(0, 200);
        logger.warn(`[wayfairInvPush][${account.label}] supplier ${supplierId} chunk ${i}-${i + chunk.length} basarisiz: ${error}`);
        for (const it of chunk) results.push({ sku: it.sku, status: 'failed', to: it.quantity, error, supplierId });
      }
    }
  }
  return results;
}

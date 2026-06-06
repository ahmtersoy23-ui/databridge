import { getSpApiClient } from './client';
import { pool } from '../../config/database';
import { MARKETPLACE_IDS } from '../../config/constants';
import logger from '../../config/logger';

/**
 * Amazon sipariş durumu canlı sorgulama (SP-API Orders API).
 *
 * ManuMaestro Sipariş board'unda, Wisersell'e iptali YANSIMAYAN Amazon
 * siparişlerini yakalamak için kullanılır. İki kullanım:
 *   - fetchCanceledOrdersSince(since): periyodik tarama — son taramadan beri
 *     iptal olmuş siparişler (getOrders, OrderStatuses=['Canceled']). Ucuz,
 *     hesap-agnostik (tüm aktif NA hesapları taranır).
 *   - fetchOrderStatusesByIds(ids): aksiyon-anı backstop — belirli siparişlerin
 *     o anki durumu (getOrder/{id}), güncelleme zamanından bağımsız.
 *
 * Sadece OKUR; Amazon'a hiçbir şey yazmaz. Yalnızca Amazon (Ama_US/Ama_CITI)
 * siparişleri için anlamlıdır — Etsy/Walmart vb. kapsam dışı (kendi API'leri).
 */

const US_MARKETPLACE = MARKETPLACE_IDS.US; // ATVPDKIKX0DER

export type OrderStatusMap = Record<string, string>; // amazonOrderId -> OrderStatus

async function getActiveNaCredentialIds(): Promise<number[]> {
  const result = await pool.query(
    `SELECT id FROM sp_api_credentials WHERE UPPER(region) = 'NA' AND is_active = true ORDER BY id`,
  );
  return result.rows.map((r: { id: number }) => r.id);
}

/**
 * Belirli sipariş ID'lerinin o anki Amazon durumu. Bir order tek hesaba ait
 * olduğundan her NA hesabı sırayla denenir; yanlış hesap NotFound/403 döner,
 * sonraki hesaba geçilir. Bulunamayan ID 'Unknown' olarak işaretlenir.
 * Düşük hacim (aksiyon anında genelde tek sipariş) için tasarlandı.
 */
export async function fetchOrderStatusesByIds(orderIds: string[]): Promise<OrderStatusMap> {
  const credIds = await getActiveNaCredentialIds();
  const out: OrderStatusMap = {};

  for (const orderId of orderIds) {
    let resolved = false;
    for (const credId of credIds) {
      try {
        const client = await getSpApiClient(credId);
        const resp: any = await client.callAPI({
          operation: 'getOrder',
          endpoint: 'orders',
          path: { orderId },
        });
        const status = resp?.OrderStatus;
        if (status) {
          out[orderId] = status;
          resolved = true;
          break;
        }
      } catch {
        // Yanlış hesap ya da geçici hata → sonraki hesabı dene.
        continue;
      }
    }
    if (!resolved) out[orderId] = 'Unknown';
  }

  return out;
}

/**
 * `since`'ten beri güncellenmiş ve iptal edilmiş US siparişlerinin ID kümesi.
 * Tüm aktif NA hesapları taranır (hesap-agnostik), NextToken ile sayfalanır.
 * Periyodik tarama için: hesap başına 1-2 çağrı, rate-limit dostu.
 */
export async function fetchCanceledOrdersSince(since: Date): Promise<Set<string>> {
  const credIds = await getActiveNaCredentialIds();
  const canceled = new Set<string>();

  const baseQuery = {
    MarketplaceIds: [US_MARKETPLACE],
    LastUpdatedAfter: since.toISOString(),
    OrderStatuses: ['Canceled'],
  };

  for (const credId of credIds) {
    const client = await getSpApiClient(credId);
    let nextToken: string | undefined;
    let pages = 0;
    do {
      const query: any = nextToken ? { ...baseQuery, NextToken: nextToken } : baseQuery;
      const resp: any = await client.callAPI({ operation: 'getOrders', endpoint: 'orders', query });
      const orders: any[] = resp?.Orders ?? [];
      for (const o of orders) {
        if (o?.AmazonOrderId) canceled.add(o.AmazonOrderId);
      }
      nextToken = resp?.NextToken;
      pages += 1;
    } while (nextToken && pages < 50); // güvenlik tavanı
  }

  logger.info(`[OrderStatus] ${canceled.size} iptal sipariş bulundu (since ${since.toISOString()})`);
  return canceled;
}

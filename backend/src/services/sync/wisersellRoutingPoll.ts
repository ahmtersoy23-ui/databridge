import { pool } from '../../config/database';
import logger from '../../config/logger';
import { getOpenOrders, type WisersellOrderRow, type WisersellOrderItem } from '../wisersell/webClient';
import { resolveBatch } from '../wisersell/iwaskuResolver';
import { WISERSELL_STATUS_CODES } from '../../config/constants';

/**
 * Wisersell routing poll — açık siparişleri sık çekip US adaylarını
 * wisersell_routing_candidates tablosuna upsert eder. ManuMaestro buradan okuyup
 * stok teyidi + onay yapar.
 *
 * - store allowlist: wisersell_store_map.region (NULL olmayan) store'lar
 * - iwasku: orderitem'ların listing.product.code / marketplace_sku / product.name → resolveBatch
 * - gone detection: artık açık poll'da görünmeyen (kargoya hazır/kapalı olmuş) US aday → gone_at
 *
 * Yazma DEĞİL — sadece okuma + kendi candidate tablosuna yazma. Wisersell'e statü
 * yazımı (Kargoya Hazır) ManuMaestro onayında /wisersell-routing/mark-ready ile yapılır.
 */

interface StoreMapRow {
  store_id: number;
  region: string | null;       // 'US' | 'UK' | 'EU' | ... | null (kapsam dışı)
  marketplace_code: string | null;
  label_prefix: string | null;
}

interface ResolvedItem {
  iwasku: string | null;
  qty: number;
  product_code: string | null;
  marketplace_sku: string | null;
  product_name: string | null;
  resolved_by: string | null;
}

async function loadStoreMap(): Promise<Map<number, StoreMapRow>> {
  const { rows } = await pool.query<StoreMapRow>(
    'SELECT store_id, region, marketplace_code, label_prefix FROM wisersell_store_map',
  );
  return new Map(rows.map(r => [r.store_id, r]));
}

/**
 * Siparişin fulfillment region'ı (allowlist). null = kapsam dışı (otomasyona girmez).
 * Şimdilik yalnız store allowlist (store_map.region). Ülke-genişletilebilir: yeni region
 * eklemek için store_map'e satır yeter. (Amazon gibi çok-ülkeli store'lar için
 * country_id/order_code prefix kuralı build-time doğrulanınca buraya eklenecek.)
 */
function resolveRegion(order: WisersellOrderRow, sm: StoreMapRow | undefined): string | null {
  return sm?.region ?? null;
}

export async function runWisersellRoutingPoll(): Promise<number> {
  const storeMap = await loadStoreMap();

  const openCodes = WISERSELL_STATUS_CODES.open; // [2, 6]
  const orders = await getOpenOrders({ status: openCodes });
  logger.info(`[WisersellRouting] poll: ${orders.length} açık sipariş çekildi (status ${openCodes.join(',')})`);

  // Allowlist'teki (region != null) adayları filtrele
  const usOrders = orders.filter(o => resolveRegion(o, storeMap.get(Number(o.storeId))) !== null);
  logger.info(`[WisersellRouting] poll: ${usOrders.length} aday (region allowlist)`);

  // Tüm orderitem'ları tek resolveBatch'te çöz
  const resolverRows: Array<{ urun_kodu: string | null; sku: string | null; urun_basligi: string | null }> = [];
  const itemIndex: Array<{ orderIdx: number; item: WisersellOrderItem }> = [];
  usOrders.forEach((o, orderIdx) => {
    for (const item of o.orderitems ?? []) {
      resolverRows.push({
        urun_kodu: item.listing?.product?.code ?? null,
        sku: item.marketplace_sku ?? null,
        urun_basligi: item.listing?.product?.name ?? null,
      });
      itemIndex.push({ orderIdx, item });
    }
  });
  const resolutions = resolverRows.length ? await resolveBatch(resolverRows) : [];

  // orderIdx → resolved items
  const itemsByOrder = new Map<number, ResolvedItem[]>();
  itemIndex.forEach(({ orderIdx, item }, i) => {
    const arr = itemsByOrder.get(orderIdx) ?? [];
    arr.push({
      iwasku: resolutions[i]?.iwasku ?? null,
      qty: Number(item.quantity ?? 0),
      product_code: item.listing?.product?.code ?? null,
      marketplace_sku: item.marketplace_sku ?? null,
      product_name: item.listing?.product?.name ?? null,
      resolved_by: resolutions[i]?.resolved_by ?? null,
    });
    itemsByOrder.set(orderIdx, arr);
  });

  const client = await pool.connect();
  const seenIds: number[] = [];
  try {
    await client.query('BEGIN');
    for (let i = 0; i < usOrders.length; i++) {
      const o = usOrders[i];
      const items = itemsByOrder.get(i) ?? [];
      seenIds.push(Number(o.id));
      const region = resolveRegion(o, storeMap.get(Number(o.storeId)));
      await client.query(
        `INSERT INTO wisersell_routing_candidates
           (wisersell_order_id, order_code, store_id, country_id, currency_id, orderstatus_id,
            recipient_name, label_no, ws_shipment_date, created_at_ws, orderitems, region, raw_row,
            first_seen_at, last_seen_at, gone_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13::jsonb, NOW(), NOW(), NULL)
         ON CONFLICT (wisersell_order_id) DO UPDATE SET
           order_code     = EXCLUDED.order_code,
           store_id       = EXCLUDED.store_id,
           country_id     = EXCLUDED.country_id,
           currency_id    = EXCLUDED.currency_id,
           orderstatus_id = EXCLUDED.orderstatus_id,
           recipient_name = EXCLUDED.recipient_name,
           label_no       = EXCLUDED.label_no,
           ws_shipment_date = EXCLUDED.ws_shipment_date,
           created_at_ws  = EXCLUDED.created_at_ws,
           orderitems     = EXCLUDED.orderitems,
           region         = EXCLUDED.region,
           raw_row        = EXCLUDED.raw_row,
           last_seen_at   = NOW(),
           gone_at        = NULL`,
        [
          Number(o.id),
          o.order_code,
          o.storeId ?? null,
          o.countryId ?? null,
          o.currency_id ?? null,
          o.orderstatus_id ?? null,
          o.name ?? o.customer?.name ?? null,
          o.labelNo ?? null,
          o.shipment_date ? Number(o.shipment_date) : null,
          o.created_at ?? null,
          JSON.stringify(items),
          region,
          JSON.stringify(o),
        ],
      );
    }

    // gone detection: artık açık poll'da görünmeyen (kargoya hazır/kapalı olmuş) adayları işaretle
    if (seenIds.length) {
      await client.query(
        `UPDATE wisersell_routing_candidates
         SET gone_at = NOW()
         WHERE region IS NOT NULL AND gone_at IS NULL AND wisersell_order_id <> ALL($1::bigint[])`,
        [seenIds],
      );
    } else {
      await client.query(
        `UPDATE wisersell_routing_candidates SET gone_at = NOW() WHERE region IS NOT NULL AND gone_at IS NULL`,
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  logger.info(`[WisersellRouting] poll OK: ${usOrders.length} aday upsert edildi (region allowlist)`);
  return usOrders.length;
}

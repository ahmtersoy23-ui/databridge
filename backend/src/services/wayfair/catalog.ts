import { graphqlQuery, getSupplierId, type WayfairAccount } from './client';
import { pool } from '../../config/database';
import { errMessage } from '../../utils/errors';
import logger from '../../config/logger';

/**
 * Wayfair dropship katalog — loadSupplierParts (supplier-order-api .io endpoint).
 * Bir supplier'ın TÜM listeli part'larını döndürür (sadece satılanlar değil) +
 * wayfair_sku_mapping üzerinden iwasku join. Stok Push'un SKU evreni bu.
 *
 * supplierPartFilter.supplierId.equalTo = supplier'ın parent id'si (MDN: 275550).
 * Sayfalama offset tabanlı (katalog birkaç yüz part — offset güvenli).
 */

export interface WayfairCatalogPart {
  supplierPartNumber: string; // suPartNum — inventory.save'in supplierPartNumber'ı
  supplierId: number;
  isActive: boolean;
  iwasku: string | null;
}

const PARTS_QUERY = `
  query loadSupplierParts($search: SupplierPartSearch) {
    loadSupplierParts(search: $search) {
      numFound
      supplierParts { suPartNum supplierId isActive }
    }
  }
`;

interface PartsResponse {
  loadSupplierParts: {
    numFound: number;
    supplierParts: { suPartNum: string; supplierId: number; isActive: boolean }[];
  } | null;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const PAGE = 100;

/**
 * Bir Wayfair hesabının tüm dropship katalog part'larını çeker (iwasku join'li).
 * @param activeOnly true → sadece isActive=true part'lar.
 */
export async function fetchWayfairCatalog(
  account: WayfairAccount,
  opts: { activeOnly?: boolean } = {},
): Promise<WayfairCatalogPart[]> {
  const supplierId = await getSupplierId(account);

  // iwasku eşlemesi (DB) — part_number -> iwasku
  const mapRes = await pool.query<{ part_number: string; iwasku: string }>(
    'SELECT part_number, iwasku FROM wayfair_sku_mapping',
  );
  const iwaskuByPart = new Map(mapRes.rows.map((r) => [r.part_number, r.iwasku]));

  const all: WayfairCatalogPart[] = [];
  const seen = new Set<string>();
  let offset = 0;

  while (true) {
    let result: PartsResponse;
    try {
      result = await graphqlQuery<PartsResponse>(account, PARTS_QUERY, {
        search: {
          supplierPartFilter: { supplierId: { equalTo: supplierId } },
          limit: PAGE,
          offset,
        },
      });
    } catch (err: unknown) {
      const msg = errMessage(err) || '';
      // Sandbox / veri yok durumunda Wayfair non-null connection null döndürür
      if (msg.includes('wrongly returned a null value') || msg.includes('Internal Server Error')) {
        logger.info(`[Wayfair][${account.label}] catalog unavailable (no data)`);
        break;
      }
      throw err;
    }

    const conn = result.loadSupplierParts;
    const parts = conn?.supplierParts ?? [];
    if (!parts.length) break;

    for (const p of parts) {
      if (!p.suPartNum || seen.has(p.suPartNum)) continue;
      if (opts.activeOnly && !p.isActive) continue;
      seen.add(p.suPartNum);
      all.push({
        supplierPartNumber: p.suPartNum,
        supplierId: p.supplierId,
        isActive: p.isActive,
        iwasku: iwaskuByPart.get(p.suPartNum) ?? null,
      });
    }

    logger.info(
      `[Wayfair][${account.label}] catalog page offset=${offset}: ${parts.length} parts (numFound=${conn?.numFound ?? '?'}, total=${all.length})`,
    );

    offset += PAGE;
    if (offset >= (conn?.numFound ?? 0)) break;
    await delay(400); // ~2 req/sec — 10 req/sec limitinin altı
  }

  return all;
}

/**
 * DB tabanlı katalog (API fallback). loadSupplierParts/integrations query'leri bizim
 * dropship hesaplarımız için `null` döndüğünden (izin/scope duvarı, MCF gibi), evren
 * şimdilik DB'den: wayfair_sku_mapping ∩ ilgili hesabın dropship sipariş geçmişi.
 * Sadece iwasku eşleşeni döner (availability için iwasku şart). Wayfair scope açılıp
 * fetchWayfairCatalog canlı veri verince buradan ona geçilir.
 */
export async function fetchWayfairCatalogFromDb(accountId: number): Promise<WayfairCatalogPart[]> {
  const res = await pool.query<{ part_number: string; iwasku: string; supplier_id: number | null }>(
    `SELECT DISTINCT m.part_number, m.iwasku, MAX(o.supplier_id) AS supplier_id
       FROM wayfair_sku_mapping m
       JOIN wayfair_orders o
         ON o.part_number = m.part_number
        AND o.account_id = $1
        AND o.order_type = 'dropship'
      WHERE m.iwasku IS NOT NULL
      GROUP BY m.part_number, m.iwasku
      ORDER BY m.part_number`,
    [accountId],
  );
  return res.rows.map((r) => ({
    supplierPartNumber: r.part_number,
    supplierId: r.supplier_id ?? 0,
    isActive: true,
    iwasku: r.iwasku,
  }));
}

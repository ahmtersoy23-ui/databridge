import { graphqlQuery, getSupplierId } from './client';
import logger from '../../config/logger';

export interface WayfairInventoryItem {
  partNumber: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
}

// New CastleGate On-hand API (inventorySummaryList) — required for Wayfair sandbox approval
const INVENTORY_QUERY = `
  query inventorySummaryList($supplierId: Int!, $first: Int!, $cursor: String) {
    inventorySummaryList(
      supplierId: $supplierId
      page: { first: $first, after: $cursor }
    ) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          supplierPartNumber
          inventoryPosition {
            castleGate {
              onHandQty
              warehouses {
                warehouseId
                onHandQty
              }
            }
          }
        }
      }
    }
  }
`;

interface InventoryWarehouse {
  warehouseId: string;
  onHandQty: number;
}

interface InventoryNode {
  supplierPartNumber: string;
  inventoryPosition: {
    castleGate: {
      onHandQty: number;
      warehouses?: InventoryWarehouse[];
    } | null;
  };
}

interface InventoryResponse {
  inventorySummaryList: {
    edges: { node: InventoryNode }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch all CastleGate on-hand inventory items via inventorySummaryList.
 * Returns one row per warehouse per part (or a single CASTLEGATE row if no breakdown).
 * Wayfair API rate limit: 10 req/sec — throttled to ~2 req/sec for safety.
 */
export async function fetchWayfairInventory(): Promise<WayfairInventoryItem[]> {
  const supplierId = await getSupplierId();
  const all: WayfairInventoryItem[] = [];
  let cursor: string | null = null;
  let page = 0;

  while (true) {
    let result: InventoryResponse;
    try {
      result = await graphqlQuery<InventoryResponse>(INVENTORY_QUERY, {
        supplierId,
        first: 100,
        cursor: cursor ?? undefined,
      });
    } catch (err: any) {
      const msg: string = err.message || '';
      if (
        msg.includes('wrongly returned a null value') ||
        msg.includes('Internal Server Error')
      ) {
        logger.info('[Wayfair] Inventory data unavailable (sandbox has no data for this supplier)');
        break;
      }
      throw err;
    }

    const conn = result.inventorySummaryList;
    if (!conn?.edges?.length) break;

    for (const { node } of conn.edges) {
      const cg = node.inventoryPosition?.castleGate;
      if (!cg) continue;

      const warehouses = cg.warehouses?.filter(w => w.onHandQty > 0);
      if (warehouses && warehouses.length > 0) {
        // Store per-warehouse breakdown
        for (const wh of warehouses) {
          all.push({
            partNumber: node.supplierPartNumber,
            warehouseId: String(wh.warehouseId),
            warehouseName: `CastleGate WH ${wh.warehouseId}`,
            quantity: wh.onHandQty,
          });
        }
      } else {
        // No warehouse breakdown — store total as single CASTLEGATE row
        all.push({
          partNumber: node.supplierPartNumber,
          warehouseId: 'CASTLEGATE',
          warehouseName: 'CastleGate',
          quantity: cg.onHandQty ?? 0,
        });
      }
    }

    logger.info(`[Wayfair] Page ${page}: ${conn.edges.length} items (total: ${all.length})`);

    if (!conn.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
    page++;
    await delay(500); // ~2 req/sec — well within 10 req/sec limit
  }

  return all;
}

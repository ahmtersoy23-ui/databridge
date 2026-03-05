import { graphqlQuery, getSupplierId } from './client';
import logger from '../../config/logger';

export interface WayfairInventoryItem {
  partNumber: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
}

const INVENTORY_QUERY = `
  query GetInventory($supplierId: Int!, $first: Int!, $cursor: String) {
    integrationsSupplierPartsInventory(
      supplierId: $supplierId
      filter: {}
      page: { first: $first, after: $cursor }
    ) {
      edges {
        node {
          supplierPartNumber
          inventoryPosition {
            totalFulfillableQty
            castleGate { onHandQty }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

interface InventoryNode {
  supplierPartNumber: string;
  inventoryPosition: {
    totalFulfillableQty: number;
    castleGate: { onHandQty: number } | null;
  };
}

interface InventoryResponse {
  integrationsSupplierPartsInventory: {
    edges: { node: InventoryNode }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch all CastleGate inventory items with cursor pagination.
 * Wayfair API rate limit: 10 req/sec — throttled to ~2 req/sec for safety.
 */
export async function fetchWayfairInventory(): Promise<WayfairInventoryItem[]> {
  const supplierId = await getSupplierId();
  const all: WayfairInventoryItem[] = [];
  let cursor: string | null = null;
  let page = 0;

  while (true) {
    const result: InventoryResponse = await graphqlQuery<InventoryResponse>(INVENTORY_QUERY, {
      supplierId,
      first: 100,
      cursor: cursor ?? undefined,
    });

    const conn: InventoryResponse['integrationsSupplierPartsInventory'] = result.integrationsSupplierPartsInventory;
    if (!conn?.edges?.length) break;

    for (const { node } of conn.edges) {
      all.push({
        partNumber: node.supplierPartNumber,
        warehouseId: 'CASTLEGATE',
        warehouseName: 'CastleGate',
        quantity: node.inventoryPosition?.totalFulfillableQty ?? 0,
      });
    }

    logger.info(`[Wayfair] Page ${page}: ${conn.edges.length} items (total: ${all.length})`);

    if (!conn.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
    page++;
    await delay(500); // 2 req/sec — well within 10 req/sec limit
  }

  return all;
}

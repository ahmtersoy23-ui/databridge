import { graphqlQuery } from './client';
import logger from '../../config/logger';

export interface WayfairInventoryItem {
  partNumber: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
}

// CastleGate inventory query — will be validated/adjusted against real sandbox schema
// Wayfair GraphQL schema uses inventoryOverview or similar; adjust field names after sandbox test
const INVENTORY_QUERY = `
  query GetCastlegateInventory($supplierPartNumbers: [String]) {
    inventoryOverview(supplierPartNumbers: $supplierPartNumbers) {
      supplierPartNumber
      quantityOnHand
      quantityOnOrder
      warehouses {
        warehouseId
        warehouseName
        quantityOnHand
      }
    }
  }
`;

// Alternative query for full inventory list (no filter)
const INVENTORY_ALL_QUERY = `
  query GetAllInventory {
    inventory {
      data {
        supplierPartNumber
        quantityAvailable
        warehouseId
        warehouseName
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const PAGINATED_QUERY = `
  query GetInventoryPage($cursor: String) {
    inventory(after: $cursor) {
      data {
        supplierPartNumber
        quantityAvailable
        warehouseId
        warehouseName
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

interface InventoryData {
  data: {
    supplierPartNumber: string;
    quantityAvailable: number;
    warehouseId: string;
    warehouseName: string;
  }[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch all CastleGate inventory items with cursor pagination.
 * NOTE: The exact query and field names will be confirmed after sandbox testing.
 * Wayfair API rate limit: 10 req/sec — we throttle to ~2 req/sec for safety.
 */
export async function fetchWayfairInventory(): Promise<WayfairInventoryItem[]> {
  const all: WayfairInventoryItem[] = [];
  let cursor: string | null = null;
  let page = 0;

  while (true) {
    let result: { inventory: InventoryData };

    try {
      if (cursor) {
        result = await graphqlQuery<{ inventory: InventoryData }>(
          PAGINATED_QUERY,
          { cursor }
        );
      } else {
        result = await graphqlQuery<{ inventory: InventoryData }>(
          INVENTORY_ALL_QUERY
        );
      }
    } catch (err: any) {
      // If paginated query fails (schema mismatch), throw with helpful message
      throw new Error(
        `Wayfair inventory query failed (page ${page}): ${err.message}. ` +
        'Check GraphQL schema in Wayfair Partner Portal sandbox.'
      );
    }

    const inventory = result.inventory;
    if (!inventory?.data?.length) break;

    for (const row of inventory.data) {
      all.push({
        partNumber: row.supplierPartNumber,
        warehouseId: row.warehouseId || 'CASTLEGATE',
        warehouseName: row.warehouseName || 'CastleGate',
        quantity: row.quantityAvailable ?? 0,
      });
    }

    logger.info(`[Wayfair] Page ${page}: ${inventory.data.length} items (total: ${all.length})`);

    if (!inventory.pageInfo?.hasNextPage) break;
    cursor = inventory.pageInfo.endCursor;
    page++;
    await delay(500); // 2 req/sec — well within 10 req/sec limit
  }

  return all;
}

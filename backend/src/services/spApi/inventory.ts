import { getSpApiClient, getSpApiClientByRegion } from './client';
import logger from '../../config/logger';
import type { SpApiInventorySummary } from './types';
import type { FbaInventoryItem, MarketplaceConfig } from '../../types';

export async function fetchFbaInventory(
  marketplace: MarketplaceConfig
): Promise<FbaInventoryItem[]> {
  const client = marketplace.credential_id
    ? await getSpApiClient(marketplace.credential_id)
    : await getSpApiClientByRegion(marketplace.region.toLowerCase());
  const items: FbaInventoryItem[] = [];
  let nextToken: string | undefined;

  do {
    const response: any = await client.callAPI({
      operation: 'getInventorySummaries',
      endpoint: 'fbaInventory',
      query: {
        details: true,
        granularityType: 'Marketplace',
        granularityId: marketplace.marketplace_id,
        marketplaceIds: [marketplace.marketplace_id],
        ...(nextToken ? { nextToken } : {}),
      },
    });

    const summaries: SpApiInventorySummary[] =
      response?.payload?.inventorySummaries || response?.inventorySummaries || [];

    for (const s of summaries) {
      const d = s.inventoryDetails;
      items.push({
        warehouse: marketplace.warehouse,
        marketplace_id: marketplace.marketplace_id,
        sku: s.sellerSku,
        asin: s.asin,
        fnsku: s.fnSku,
        iwasku: null, // Will be mapped later by skuMapper
        fulfillable_quantity: d?.fulfillableQuantity || 0,
        total_reserved_quantity: d?.totalReservedQuantity || 0,
        pending_customer_order_quantity: d?.pendingCustomerOrderQuantity || 0,
        pending_transshipment_quantity: d?.pendingTransshipmentQuantity || 0,
        fc_processing_quantity: d?.fcProcessingQuantity || 0,
        total_unfulfillable_quantity: d?.totalUnfulfillableQuantity || 0,
        customer_damaged_quantity: d?.customerDamagedQuantity || 0,
        warehouse_damaged_quantity: d?.warehouseDamagedQuantity || 0,
        distributor_damaged_quantity: d?.distributorDamagedQuantity || 0,
        inbound_shipped_quantity: d?.inboundShippedQuantity || 0,
        inbound_working_quantity: d?.inboundWorkingQuantity || 0,
        inbound_receiving_quantity: d?.inboundReceivingQuantity || 0,
      });
    }

    nextToken = response?.nextToken
      || response?.pagination?.nextToken
      || response?.payload?.pagination?.nextToken;
    logger.info(`[SP-API] Inventory batch: ${summaries.length} items, hasMore: ${!!nextToken}`);
  } while (nextToken);

  logger.info(`[SP-API] Fetched ${items.length} inventory items for ${marketplace.country_code}`);
  return items;
}

// SP-API FBA Inventory response types
export interface SpApiInventorySummary {
  asin: string;
  fnSku: string;
  sellerSku: string;
  condition: string;
  inventoryDetails: {
    fulfillableQuantity: number;
    inboundWorkingQuantity: number;
    inboundShippedQuantity: number;
    inboundReceivingQuantity: number;
    totalReservedQuantity: number;
    pendingCustomerOrderQuantity: number;
    pendingTransshipmentQuantity: number;
    fcProcessingQuantity: number;
    totalUnfulfillableQuantity: number;
    customerDamagedQuantity: number;
    warehouseDamagedQuantity: number;
    distributorDamagedQuantity: number;
    carrierDamagedQuantity: number;
    defectiveQuantity: number;
    expiredQuantity: number;
    totalResearchingQuantity: number;
    researchingQuantityBreakdown: unknown[];
  };
  lastUpdatedTime: string;
  productName: string;
  totalQuantity: number;
}

export interface SpApiInventoryResponse {
  payload: {
    granularity: { granularityType: string; granularityId: string };
    inventorySummaries: SpApiInventorySummary[];
  };
  pagination?: { nextToken: string };
}

// SP-API Orders/Reports types
export interface SpApiOrderItem {
  AmazonOrderId: string;
  PurchaseDate: string;
  OrderStatus: string;
  FulfillmentChannel: string;
  SalesChannel: string;
  // Report-specific fields
  sku?: string;
  asin?: string;
  quantity?: number;
  'item-price'?: number;
  currency?: string;
}

export interface SpApiReportDocument {
  reportDocumentId: string;
  url: string;
  compressionAlgorithm?: string;
}

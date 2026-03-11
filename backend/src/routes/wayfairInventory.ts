import { Router, Request, Response } from 'express';
import { graphqlQuery, getSupplierId } from '../services/wayfair/client';

const router = Router();

// GET /api/v1/wayfair/inventory/raw — ham inventorySummaryList response (ilk 5 kayıt, debug)
router.get('/raw', async (_req: Request, res: Response) => {
  try {
    const supplierId = await getSupplierId();
    const result = await graphqlQuery<unknown>(`
      query inventorySummaryList($supplierId: Int!, $first: Int!) {
        inventorySummaryList(
          supplierId: $supplierId
          page: { first: $first }
        ) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              supplierPartNumber
              sku
              productName
              inventoryPosition {
                castleGate {
                  onHandQty
                  onHand {
                    inStockQty
                    inStock { fulfillableQty }
                  }
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
    `, { supplierId, first: 5 });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

export default router;

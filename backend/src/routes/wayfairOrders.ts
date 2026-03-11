import { Router, Request, Response } from 'express';
import { getCredentials, graphqlQuery } from '../services/wayfair/client';
import { fetchWayfairPurchaseOrders } from '../services/wayfair/purchaseOrders';

const router = Router();

// GET /api/v1/wayfair/orders
router.get('/', async (_req: Request, res: Response) => {
  try {
    await getCredentials();
    const orders = await fetchWayfairPurchaseOrders();
    res.json({ data: orders, total: orders.length });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /api/v1/wayfair/orders/raw — ham GraphQL response (debug)
router.get('/raw', async (_req: Request, res: Response) => {
  try {
    await getCredentials();
    const result = await graphqlQuery<unknown>(`
      query {
        getCastleGatePurchaseOrders {
          poNumber
          poDate
          estimatedShipDate
          orderType
          products {
            partNumber
            quantity
            price
          }
        }
      }
    `);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import { getCredentials, graphqlQuery, getDropshipApiBase } from '../services/wayfair/client';
import { fetchWayfairPurchaseOrders } from '../services/wayfair/purchaseOrders';
import { fetchDropshipOrders } from '../services/wayfair/dropshipOrders';

const router = Router();

// GET /api/v1/wayfair/orders?hasResponse=false|true
router.get('/', async (req: Request, res: Response) => {
  try {
    const hasResponse = req.query.hasResponse === 'true'
      ? true
      : req.query.hasResponse === 'false'
      ? false
      : undefined;
    const orders = await fetchWayfairPurchaseOrders(hasResponse);
    res.json({ data: orders, total: orders.length });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /api/v1/wayfair/orders/dropship?hasResponse=false|true
router.get('/dropship', async (req: Request, res: Response) => {
  try {
    await getCredentials();
    const hasResponse = req.query.hasResponse === 'true'
      ? true
      : req.query.hasResponse === 'false'
      ? false
      : undefined;
    const orders = await fetchDropshipOrders(hasResponse);
    res.json({ data: orders, total: orders.length });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /api/v1/wayfair/orders/dropship/raw — ham Dropship GraphQL response (debug)
router.get('/dropship/raw', async (_req: Request, res: Response) => {
  try {
    const creds = await getCredentials();
    const endpoint = getDropshipApiBase(creds.use_sandbox);
    const result = await graphqlQuery<unknown>(`
      query getDropshipPurchaseOrders($limit: Int32, $hasResponse: Boolean, $sortOrder: SortOrder) {
        getDropshipPurchaseOrders(limit: $limit, hasResponse: $hasResponse, sortOrder: $sortOrder) {
          poNumber poDate supplierId
          products { partNumber quantity price }
        }
      }
    `, { limit: 5, hasResponse: null, sortOrder: 'DESC' }, endpoint);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /api/v1/wayfair/orders/raw — ham CastleGate GraphQL response (debug)
router.get('/raw', async (_req: Request, res: Response) => {
  try {
    const creds = await getCredentials();
    const endpoint = getDropshipApiBase(creds.use_sandbox);
    const result = await graphqlQuery<unknown>(`
      query getCastleGatePurchaseOrders($limit: Int32, $hasResponse: Boolean, $sortOrder: SortOrder) {
        getCastleGatePurchaseOrders(limit: $limit, hasResponse: $hasResponse, sortOrder: $sortOrder) {
          id poNumber poDate supplierId
          products { partNumber quantity price totalCost }
        }
      }
    `, { limit: 5, hasResponse: null, sortOrder: 'DESC' }, endpoint);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

export default router;

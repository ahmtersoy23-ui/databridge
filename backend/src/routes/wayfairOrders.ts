import { Router, Request, Response } from 'express';
import { getCredentials } from '../services/wayfair/client';
import { fetchWayfairPurchaseOrders } from '../services/wayfair/purchaseOrders';

const router = Router();

// GET /api/v1/wayfair/orders
router.get('/', async (_req: Request, res: Response) => {
  try {
    await getCredentials(); // throws if not configured
    const orders = await fetchWayfairPurchaseOrders();
    res.json({ data: orders, total: orders.length });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

export default router;

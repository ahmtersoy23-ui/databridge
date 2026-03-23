import { Router, Request, Response } from 'express';
import { getAccountById, getAccountByLabel, graphqlQuery, getDropshipApiBase } from '../services/wayfair/client';
import { fetchWayfairPurchaseOrders } from '../services/wayfair/purchaseOrders';
import { fetchDropshipOrders } from '../services/wayfair/dropshipOrders';
import { pool } from '../config/database';

const router = Router();

// Helper: resolve account from ?account=cg|mdn or default to id=1
async function resolveAccount(req: Request) {
  const label = req.query.account as string | undefined;
  return label ? getAccountByLabel(label) : getAccountById(1);
}

// GET /api/v1/wayfair/orders/browse?type=castlegate|dropship&account=cg&page=1&limit=50&search=
router.get('/browse', async (req: Request, res: Response) => {
  try {
    const orderType = (req.query.type as string) || 'castlegate';
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
    const search = ((req.query.search as string) || '').trim();
    const accountLabel = req.query.account as string | undefined;
    const offset = (page - 1) * limit;

    const conditions = ['order_type = $1'];
    const params: unknown[] = [orderType];
    let idx = 2;

    if (accountLabel) {
      const account = await getAccountByLabel(accountLabel);
      conditions.push(`account_id = $${idx}`);
      params.push(account.id);
      idx++;
    }

    if (search) {
      conditions.push(`(part_number ILIKE $${idx} OR po_number ILIKE $${idx} OR iwasku ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const where = conditions.join(' AND ');

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM wayfair_orders WHERE ${where}`, params
    );
    const total = parseInt(countRes.rows[0].count);

    const dataParams = [...params, limit, offset];
    const rows = await pool.query(`
      SELECT po_number, po_date, part_number, iwasku, quantity, price, total_cost
      FROM wayfair_orders
      WHERE ${where}
      ORDER BY po_date DESC, po_number, part_number
      LIMIT $${idx} OFFSET $${idx + 1}
    `, dataParams);

    res.json({
      success: true,
      data: rows.rows,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/wayfair/orders?account=cg&hasResponse=false|true (live API)
router.get('/', async (req: Request, res: Response) => {
  try {
    const account = await resolveAccount(req);
    const hasResponse = req.query.hasResponse === 'true'
      ? true
      : req.query.hasResponse === 'false'
      ? false
      : undefined;
    const orders = await fetchWayfairPurchaseOrders(account, hasResponse);
    res.json({ data: orders, total: orders.length });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /api/v1/wayfair/orders/dropship?account=cg&hasResponse=false|true
router.get('/dropship', async (req: Request, res: Response) => {
  try {
    const account = await resolveAccount(req);
    const hasResponse = req.query.hasResponse === 'true'
      ? true
      : req.query.hasResponse === 'false'
      ? false
      : undefined;
    const orders = await fetchDropshipOrders(account, hasResponse);
    res.json({ data: orders, total: orders.length });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /api/v1/wayfair/orders/dropship/raw?account=cg
router.get('/dropship/raw', async (req: Request, res: Response) => {
  try {
    const account = await resolveAccount(req);
    const endpoint = getDropshipApiBase(account.use_sandbox);
    const result = await graphqlQuery<unknown>(account, `
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

// GET /api/v1/wayfair/orders/raw?account=cg
router.get('/raw', async (req: Request, res: Response) => {
  try {
    const account = await resolveAccount(req);
    const endpoint = getDropshipApiBase(account.use_sandbox);
    const result = await graphqlQuery<unknown>(account, `
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

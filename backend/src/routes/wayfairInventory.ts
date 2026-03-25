import { Router, Request, Response } from 'express';
import { graphqlQuery, getSupplierId, getAccountById, getAccountByLabel } from '../services/wayfair/client';
import { pool } from '../config/database';

const router = Router();

// GET /api/v1/wayfair/inventory?account=cg&search=&page=1&limit=50
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
    const search = ((req.query.search as string) || '').trim();
    const accountLabel = req.query.account as string | undefined;
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (accountLabel) {
      const account = await getAccountByLabel(accountLabel);
      conditions.push(`wi.account_id = $${idx}`);
      params.push(account.id);
      idx++;
    }

    if (search) {
      conditions.push(`(wi.part_number ILIKE $${idx} OR wi.iwasku ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await pool.query(
      `SELECT COUNT(DISTINCT wi.part_number) FROM wayfair_inventory wi ${whereClause}`,
      params
    );
    const total = parseInt(countRes.rows[0].count);

    const dataParams = [...params, limit, offset];
    const rows = await pool.query(`
      SELECT
        wi.part_number,
        wi.iwasku,
        SUM(wi.quantity)::int AS on_hand_qty,
        MAX(wi.available_qty)::int AS available_qty,
        MAX(wi.last_synced_at) AS last_synced_at,
        MAX(m.shipping_cost)::numeric AS shipping_cost
      FROM wayfair_inventory wi
      LEFT JOIN wayfair_sku_mapping m ON m.part_number = wi.part_number
      ${whereClause}
      GROUP BY wi.part_number, wi.iwasku
      ORDER BY on_hand_qty DESC, wi.part_number
      LIMIT $${idx} OFFSET $${idx + 1}
    `, dataParams);

    res.json({
      data: rows.rows,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/wayfair/inventory/raw?account=cg
router.get('/raw', async (req: Request, res: Response) => {
  try {
    const label = req.query.account as string | undefined;
    const account = label ? await getAccountByLabel(label) : await getAccountById(1);
    const supplierId = await getSupplierId(account);
    const result = await graphqlQuery<unknown>(account, `
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

// PUT /api/v1/wayfair/inventory/shipping-cost
router.put('/shipping-cost', async (req: Request, res: Response) => {
  try {
    const { part_number, shipping_cost } = req.body;
    if (!part_number) return res.status(400).json({ success: false, error: 'part_number required' });

    const cost = shipping_cost === null || shipping_cost === '' ? null : parseFloat(shipping_cost);
    await pool.query(
      'UPDATE wayfair_sku_mapping SET shipping_cost = $1 WHERE part_number = $2',
      [cost, part_number]
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

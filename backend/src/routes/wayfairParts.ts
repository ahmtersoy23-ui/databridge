import { Router, Request, Response } from 'express';
import { pool } from '../config/database';
import { fetchWayfairPurchaseOrders } from '../services/wayfair/purchaseOrders';
import { fetchDropshipOrders } from '../services/wayfair/dropshipOrders';
import { getAccountById } from '../services/wayfair/client';

const router = Router();

// GET /api/v1/wayfair/parts — combined part_numbers from inventory + orders with mapping status
router.get('/', async (req: Request, res: Response) => {
  try {
    const search = ((req.query.search as string) || '').trim();
    const filter = (req.query.filter as string) || 'all'; // all | matched | unmatched
    const includeOrders = req.query.includeOrders === 'true';

    // Get all part_numbers from inventory + orders + mapping table
    const dbResult = await pool.query(`
      WITH all_parts AS (
        SELECT part_number FROM wayfair_inventory
        UNION
        SELECT part_number FROM wayfair_orders
        UNION
        SELECT part_number FROM wayfair_sku_mapping
      )
      SELECT
        ap.part_number,
        m.iwasku,
        COALESCE(SUM(wi.quantity), 0) as inv_qty,
        CASE WHEN MAX(wi.part_number) IS NOT NULL THEN true ELSE false END as in_inventory,
        CASE WHEN MAX(wo.part_number) IS NOT NULL THEN true ELSE false END as in_orders
      FROM all_parts ap
      LEFT JOIN wayfair_sku_mapping m ON m.part_number = ap.part_number
      LEFT JOIN wayfair_inventory wi ON wi.part_number = ap.part_number
      LEFT JOIN (SELECT DISTINCT part_number FROM wayfair_orders) wo ON wo.part_number = ap.part_number
      GROUP BY ap.part_number, m.iwasku
      ORDER BY ap.part_number
    `);

    // Build parts map
    const partsMap = new Map<string, { part_number: string; iwasku: string | null; inv_qty: number; in_inventory: boolean; in_orders: boolean }>();
    for (const r of dbResult.rows) {
      partsMap.set(r.part_number, {
        part_number: r.part_number,
        iwasku: r.iwasku || null,
        inv_qty: Number(r.inv_qty),
        in_inventory: r.in_inventory,
        in_orders: r.in_orders,
      });
    }

    // Optionally add order part_numbers
    if (includeOrders) {
      try {
        const defaultAccount = await getAccountById(1);
        const [cgOrders, dsOrders] = await Promise.all([
          fetchWayfairPurchaseOrders(defaultAccount),
          fetchDropshipOrders(defaultAccount),
        ]);
        for (const o of cgOrders) for (const p of o.products) {
          const existing = partsMap.get(p.partNumber);
          if (existing) {
            existing.in_orders = true;
          } else {
            partsMap.set(p.partNumber, { part_number: p.partNumber, iwasku: null, inv_qty: 0, in_inventory: false, in_orders: true });
          }
        }
        for (const o of dsOrders) for (const p of o.products) {
          const existing = partsMap.get(p.partNumber);
          if (existing) {
            existing.in_orders = true;
          } else {
            partsMap.set(p.partNumber, { part_number: p.partNumber, iwasku: null, inv_qty: 0, in_inventory: false, in_orders: true });
          }
        }
      } catch {
        // If order fetch fails, continue with DB-only data
      }
    }

    // Convert to array and apply filters
    let parts = Array.from(partsMap.values());

    if (search) {
      const s = search.toLowerCase();
      parts = parts.filter(p => p.part_number.toLowerCase().includes(s) || (p.iwasku && p.iwasku.toLowerCase().includes(s)));
    }

    if (filter === 'matched') {
      parts = parts.filter(p => p.iwasku);
    } else if (filter === 'unmatched') {
      parts = parts.filter(p => !p.iwasku);
    }

    // Sort: unmatched first, then by part_number
    parts.sort((a, b) => {
      if (!a.iwasku && b.iwasku) return -1;
      if (a.iwasku && !b.iwasku) return 1;
      return a.part_number.localeCompare(b.part_number);
    });

    // Pagination
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
    const total = parts.length;
    const totalMatched = parts.filter(p => p.iwasku).length;
    const totalUnmatched = total - totalMatched;
    const paginated = parts.slice((page - 1) * limit, page * limit);

    res.json({
      success: true,
      data: paginated,
      summary: { total, matched: totalMatched, unmatched: totalUnmatched },
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

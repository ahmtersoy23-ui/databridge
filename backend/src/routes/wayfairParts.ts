import { Router, Request, Response } from 'express';
import { pool } from '../config/database';

const router = Router();

// GET /api/v1/wayfair/parts — combined part_numbers from inventory + orders with mapping status
router.get('/', async (req: Request, res: Response) => {
  try {
    const search = ((req.query.search as string) || '').trim();
    const filter = (req.query.filter as string) || 'all'; // all | matched | unmatched

    // Get all part_numbers from inventory + orders + mapping table with account info (DB only)
    const dbResult = await pool.query(`
      WITH part_accounts AS (
        SELECT part_number, account_id FROM wayfair_inventory
        UNION
        SELECT part_number, account_id FROM wayfair_orders
      ),
      account_agg AS (
        SELECT pa.part_number,
          array_agg(DISTINCT wc.label ORDER BY wc.label) as accounts
        FROM part_accounts pa
        JOIN wayfair_credentials wc ON wc.id = pa.account_id
        GROUP BY pa.part_number
      ),
      all_parts AS (
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
        CASE WHEN MAX(wo.part_number) IS NOT NULL THEN true ELSE false END as in_orders,
        COALESCE(aa.accounts, ARRAY[]::text[]) as accounts
      FROM all_parts ap
      LEFT JOIN wayfair_sku_mapping m ON m.part_number = ap.part_number
      LEFT JOIN wayfair_inventory wi ON wi.part_number = ap.part_number
      LEFT JOIN (SELECT DISTINCT part_number FROM wayfair_orders) wo ON wo.part_number = ap.part_number
      LEFT JOIN account_agg aa ON aa.part_number = ap.part_number
      GROUP BY ap.part_number, m.iwasku, aa.accounts
      ORDER BY ap.part_number
    `);

    let parts = dbResult.rows.map(r => ({
      part_number: r.part_number,
      iwasku: r.iwasku || null,
      inv_qty: Number(r.inv_qty),
      in_inventory: r.in_inventory,
      in_orders: r.in_orders,
      accounts: r.accounts || [],
    }));

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

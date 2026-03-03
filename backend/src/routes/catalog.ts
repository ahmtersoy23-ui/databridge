import { Router, Request, Response } from 'express';
import { pool } from '../config/database';

const router = Router();

function longestCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return '';
  let prefix = strings[0];
  for (let i = 1; i < strings.length; i++) {
    while (!strings[i].startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
      if (!prefix) return '';
    }
  }
  return prefix.trim();
}

// GET /api/v1/catalog — All Wisersell products
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT wp.id, wp.name, wp.code, wp.weight, wp.deci,
             wp.width, wp.length, wp.height,
             wp.arr_sku, wp.category_id, wp.size, wp.color,
             wc.name AS category_name,
             wp.synced_at
      FROM wisersell_products wp
      LEFT JOIN wisersell_categories wc ON wp.category_id = wc.id
      ORDER BY wp.code NULLS LAST, wp.name
    `);

    const rows = result.rows;

    // Group names by identifier
    const groups = new Map<string, string[]>();
    for (const row of rows) {
      const m = row.code?.match(/^([A-Za-z]+)([0-9]{3})/);
      const id = m ? `${m[1]}-${m[2]}` : null;
      if (id) {
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id)!.push(row.name || '');
      }
    }

    // Compute LCP per identifier
    const parentNames = new Map<string, string>();
    for (const [id, names] of groups) {
      parentNames.set(id, longestCommonPrefix(names));
    }

    // Enrich rows with identifier + product_name
    const enriched = rows.map(row => {
      const m = row.code?.match(/^([A-Za-z]+)([0-9]{3})/);
      const identifier = m ? `${m[1]}-${m[2]}` : null;
      return {
        ...row,
        identifier,
        product_name: identifier ? (parentNames.get(identifier) || null) : null,
      };
    });

    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

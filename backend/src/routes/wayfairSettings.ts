import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/database';
import { validateBody } from '../middleware/validate';
import {
  clearWayfairTokenCache, getAccountById, getApiBase, graphqlQuery, getSupplierId,
  type WayfairAccount
} from '../services/wayfair/client';
import { encryptCredential } from '../utils/crypto';

const router = Router();

const credSchema = z.object({
  label: z.string().min(1).max(20),
  client_id: z.string().min(1),
  client_secret: z.string().optional(),
  use_sandbox: z.boolean().default(false),
  supplier_id: z.number().int().positive().optional(),
  channel: z.string().min(1).max(10),
  warehouse: z.string().min(1).max(10),
});

// GET /api/v1/wayfair/settings — list all accounts
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, label, client_id, use_sandbox, supplier_id, channel, warehouse, is_active, updated_at FROM wayfair_credentials ORDER BY id'
    );
    res.json({ accounts: result.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/wayfair/settings — create or update account
router.post('/', validateBody(credSchema), async (req: Request, res: Response) => {
  const { label, client_id, client_secret, use_sandbox, supplier_id, channel, warehouse } = req.body;
  try {
    if (!client_secret) {
      res.status(400).json({ success: false, error: 'client_secret is required' });
      return;
    }
    const encryptedSecret = encryptCredential(client_secret);
    const result = await pool.query(`
      INSERT INTO wayfair_credentials (label, client_id, client_secret, use_sandbox, supplier_id, channel, warehouse)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (label) DO UPDATE SET
        client_id = EXCLUDED.client_id,
        client_secret = EXCLUDED.client_secret,
        use_sandbox = EXCLUDED.use_sandbox,
        supplier_id = COALESCE(EXCLUDED.supplier_id, wayfair_credentials.supplier_id),
        channel = EXCLUDED.channel,
        warehouse = EXCLUDED.warehouse,
        updated_at = NOW()
      RETURNING id
    `, [label, client_id, encryptedSecret, use_sandbox, supplier_id ?? null, channel, warehouse]);

    clearWayfairTokenCache(result.rows[0].id);
    res.json({ success: true, id: result.rows[0].id });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/v1/wayfair/settings/:id — update account (without changing secret)
router.put('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const { label, client_id, client_secret, use_sandbox, supplier_id, channel, warehouse, is_active } = req.body;
  try {
    const fields: string[] = [];
    const params: unknown[] = [id];
    let idx = 2;

    if (label !== undefined) { fields.push(`label = $${idx}`); params.push(label); idx++; }
    if (client_id !== undefined) { fields.push(`client_id = $${idx}`); params.push(client_id); idx++; }
    if (client_secret) { fields.push(`client_secret = $${idx}`); params.push(encryptCredential(client_secret)); idx++; }
    if (use_sandbox !== undefined) { fields.push(`use_sandbox = $${idx}`); params.push(use_sandbox); idx++; }
    if (supplier_id !== undefined) { fields.push(`supplier_id = $${idx}`); params.push(supplier_id); idx++; }
    if (channel !== undefined) { fields.push(`channel = $${idx}`); params.push(channel); idx++; }
    if (warehouse !== undefined) { fields.push(`warehouse = $${idx}`); params.push(warehouse); idx++; }
    if (is_active !== undefined) { fields.push(`is_active = $${idx}`); params.push(is_active); idx++; }

    if (fields.length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update' });
      return;
    }

    fields.push('updated_at = NOW()');
    await pool.query(`UPDATE wayfair_credentials SET ${fields.join(', ')} WHERE id = $1`, params);
    clearWayfairTokenCache(id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/v1/wayfair/settings/:id
router.delete('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  try {
    await pool.query('DELETE FROM wayfair_credentials WHERE id = $1', [id]);
    clearWayfairTokenCache(id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/wayfair/settings/:id/test — test connection
router.post('/:id/test', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const account = await getAccountById(id);
    const graphqlUrl = getApiBase(account.use_sandbox);

    await graphqlQuery<{ __typename: string }>(account, `{ __typename }`);

    let supplierId: number | null = null;
    let supplierMessage = '';
    try {
      supplierId = await getSupplierId(account);
      supplierMessage = `, Supplier ID: ${supplierId}`;
    } catch {
      supplierMessage = ' (supplier ID not found — enter manually)';
    }

    res.json({
      success: true,
      sandbox: account.use_sandbox,
      apiBase: graphqlUrl,
      supplierId,
      message: `Connection successful${supplierMessage}`,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /api/v1/wayfair/settings/schema — GraphQL introspection (uses first active account)
router.get('/schema', async (_req: Request, res: Response) => {
  try {
    const account = await getAccountById(1);
    const result = await graphqlQuery<{
      __schema: { queryType: { fields: { name: string; description: string }[] } }
    }>(account, `{ __schema { queryType { fields { name description } } } }`);
    const fields = result.__schema.queryType.fields.map(f => ({ name: f.name, description: f.description }));
    res.json({ fields });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /api/v1/wayfair/settings/type/:typeName
router.get('/type/:typeName', async (req: Request, res: Response) => {
  try {
    const { typeName } = req.params;
    const account = await getAccountById(1);
    const result = await graphqlQuery<{
      __type: { fields: { name: string; type: { name: string | null; kind: string; ofType: { name: string | null } | null } }[] } | null
    }>(
      account,
      `query IntrospectType($typeName: String!) { __type(name: $typeName) { fields { name type { name kind ofType { name } } } } }`,
      { typeName }
    );
    if (!result.__type) {
      res.status(404).json({ success: false, error: `Type '${typeName}' not found` });
      return;
    }
    res.json({ type: typeName, fields: result.__type.fields });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/database';
import { validateBody } from '../middleware/validate';
import { clearWayfairTokenCache, getCredentials, getApiBase, graphqlQuery, getSupplierId } from '../services/wayfair/client';

const router = Router();

const credSchema = z.object({
  client_id: z.string().min(1),
  client_secret: z.string().optional(),
  use_sandbox: z.boolean().default(true),
  supplier_id: z.number().int().positive().optional(),
});

// GET /api/v1/wayfair/settings
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT client_id, use_sandbox, supplier_id, updated_at FROM wayfair_credentials WHERE id = 1'
    );
    if (!result.rows.length) {
      res.json({ configured: false });
      return;
    }
    res.json({ configured: true, ...result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/wayfair/settings
router.post('/', validateBody(credSchema), async (req: Request, res: Response) => {
  const { client_id, client_secret, use_sandbox, supplier_id } = req.body;
  try {
    if (client_secret) {
      await pool.query(`
        INSERT INTO wayfair_credentials (id, client_id, client_secret, use_sandbox, supplier_id)
        VALUES (1, $1, $2, $3, $4)
        ON CONFLICT (id) DO UPDATE SET
          client_id = EXCLUDED.client_id,
          client_secret = EXCLUDED.client_secret,
          use_sandbox = EXCLUDED.use_sandbox,
          supplier_id = COALESCE(EXCLUDED.supplier_id, wayfair_credentials.supplier_id),
          updated_at = NOW()
      `, [client_id, client_secret, use_sandbox, supplier_id ?? null]);
    } else {
      await pool.query(`
        INSERT INTO wayfair_credentials (id, client_id, client_secret, use_sandbox, supplier_id)
        VALUES (1, $1, '', $2, $3)
        ON CONFLICT (id) DO UPDATE SET
          client_id = EXCLUDED.client_id,
          use_sandbox = EXCLUDED.use_sandbox,
          supplier_id = COALESCE(EXCLUDED.supplier_id, wayfair_credentials.supplier_id),
          updated_at = NOW()
      `, [client_id, use_sandbox, supplier_id ?? null]);
    }

    clearWayfairTokenCache();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/wayfair/settings/schema — list available GraphQL query names
router.get('/schema', async (_req: Request, res: Response) => {
  try {
    const result = await graphqlQuery<{
      __schema: { queryType: { fields: { name: string; description: string }[] } }
    }>(`{ __schema { queryType { fields { name description } } } }`);
    const fields = result.__schema.queryType.fields.map(f => ({ name: f.name, description: f.description }));
    res.json({ fields });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /api/v1/wayfair/settings/type/:typeName — introspect fields of a GraphQL type
router.get('/type/:typeName', async (req: Request, res: Response) => {
  try {
    const { typeName } = req.params;
    const result = await graphqlQuery<{
      __type: { fields: { name: string; type: { name: string | null; kind: string; ofType: { name: string | null } | null } }[] } | null
    }>(
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

// POST /api/v1/wayfair/settings/test — test token + discover supplier ID
router.post('/test', async (_req: Request, res: Response) => {
  try {
    const creds = await getCredentials();
    const graphqlUrl = getApiBase(creds.use_sandbox);

    // Verify connectivity with introspection
    await graphqlQuery<{ __typename: string }>(`{ __typename }`);

    // Try to discover/confirm supplier ID
    let supplierId: number | null = null;
    let supplierMessage = '';
    try {
      supplierId = await getSupplierId();
      supplierMessage = `, Supplier ID: ${supplierId}`;
    } catch {
      supplierMessage = ' (supplier ID not found — sandbox limitation or enter manually)';
    }

    res.json({
      success: true,
      sandbox: creds.use_sandbox,
      apiBase: graphqlUrl,
      supplierId,
      message: `Connection successful${supplierMessage}`,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

export default router;

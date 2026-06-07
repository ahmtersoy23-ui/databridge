import 'dotenv/config';
import { errMessage } from '../utils/errors';
import { getSpApiClient } from '../services/spApi/client';
import { pool } from '../config/database';

async function main() {
  const result = await pool.query<{ amazon_order_id: string }>(`
    SELECT DISTINCT amazon_order_id
    FROM raw_orders
    WHERE channel = 'ca' AND fulfillment_channel = 'Merchant'
      AND purchase_date >= '2026-01-01' AND purchase_date < '2026-04-01'
      AND order_status = 'Shipped'
    LIMIT 2
  `);

  console.log('Sample orders:', result.rows.map(r => r.amazon_order_id));
  const client = await getSpApiClient(5);

  for (const row of result.rows) {
    console.log(`\n=== ${row.amazon_order_id} ===`);
    try {
      const response: any = await client.callAPI({
        operation: 'getOrder',
        endpoint: 'orders',
        path: { orderId: row.amazon_order_id },
        query: { includedData: ['PACKAGES'] },
        options: { version: '2026-01-01' },
      } as any);
      console.log(JSON.stringify(response, null, 2));
    } catch (err: unknown) {
      console.error('Error:', errMessage(err) || err);
      console.error('Full:', err);
    }
  }

  await pool.end();
}

main().catch(console.error);

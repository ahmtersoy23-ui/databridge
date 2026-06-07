import 'dotenv/config';
import { errMessage } from '../utils/errors';
import { readFileSync, writeFileSync } from 'fs';
import { getSpApiClient } from '../services/spApi/client';

const CANADA_CREDENTIAL_ID = 5;
const INPUT_PATH = '/tmp/ca_fbm_q1_orders.tsv';
const OUTPUT_PATH = '/tmp/canada_fbm_tracking_q1_2026.csv';

function csvEscape(val: string): string {
  if (val == null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

interface OrderRow {
  amazon_order_id: string;
  purchase_date: string;
  sku: string;
  asin: string;
  order_status: string;
}

async function main() {
  const lines = readFileSync(INPUT_PATH, 'utf8').trim().split('\n');
  const orders: OrderRow[] = lines.map(line => {
    const [amazon_order_id, purchase_date, sku, asin, order_status] = line.split('\t');
    return { amazon_order_id, purchase_date, sku: sku || '', asin: asin || '', order_status: order_status || '' };
  });
  console.log(`[tracking-pull] Loaded ${orders.length} unique FBM orders from ${INPUT_PATH}`);

  const client = await getSpApiClient(CANADA_CREDENTIAL_ID);

  const csvRows: string[] = [
    'amazon_order_id,purchase_date,db_order_status,db_sku,db_asin,carrier,tracking_number,ship_time,package_status,note'
  ];

  let processed = 0;
  let withTracking = 0;
  let noPackages = 0;
  let errors = 0;

  for (const order of orders) {
    processed++;
    try {
      const response: any = await client.callAPI({
        operation: 'getOrder',
        endpoint: 'orders',
        path: { orderId: order.amazon_order_id },
        query: { includedData: ['PACKAGES'] },
        options: { version: '2026-01-01' },
      } as any);

      const orderData = response?.order || response;
      const packages: any[] = orderData?.packages || [];

      if (packages.length === 0) {
        noPackages++;
        csvRows.push([
          csvEscape(order.amazon_order_id),
          csvEscape(order.purchase_date),
          csvEscape(order.order_status),
          csvEscape(order.sku),
          csvEscape(order.asin),
          '', '', '', '',
          'NO_PACKAGES'
        ].join(','));
      } else {
        for (const pkg of packages) {
          withTracking++;
          csvRows.push([
            csvEscape(order.amazon_order_id),
            csvEscape(order.purchase_date),
            csvEscape(order.order_status),
            csvEscape(order.sku),
            csvEscape(order.asin),
            csvEscape(pkg.carrier || ''),
            csvEscape(pkg.trackingNumber || ''),
            csvEscape(pkg.shipTime || pkg.createdTime || ''),
            csvEscape(pkg.packageStatus?.status || ''),
            ''
          ].join(','));
        }
      }

      if (processed % 25 === 0) {
        console.log(`[tracking-pull] ${processed}/${orders.length} (packages=${withTracking}, empty=${noPackages}, err=${errors})`);
      }
    } catch (err: unknown) {
      errors++;
      const errMsg = (errMessage(err) || String(err)).slice(0, 200);
      console.error(`[tracking-pull] ${order.amazon_order_id}: ${errMsg}`);
      csvRows.push([
        csvEscape(order.amazon_order_id),
        csvEscape(order.purchase_date),
        csvEscape(order.order_status),
        csvEscape(order.sku),
        csvEscape(order.asin),
        '', '', '', '',
        csvEscape('ERROR: ' + errMsg)
      ].join(','));
    }
  }

  writeFileSync(OUTPUT_PATH, csvRows.join('\n'));
  console.log(`\n[tracking-pull] Done. orders=${processed}, packages=${withTracking}, empty=${noPackages}, errors=${errors}`);
  console.log(`[tracking-pull] Output: ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('[tracking-pull] Fatal:', err);
  process.exit(1);
});

import 'dotenv/config';
import { getOrderByNumber, getRates } from '../services/veeqo/client';

/**
 * READ-ONLY doğrulama: client.getRates() + Amazon modu (is_amazon_order + channel_items).
 * Etiket ALMAZ. Run:
 *   VEEQO_API_KEY=... VEEQO_SHIP_FROM_PHONE=+19085551234 \
 *   npx ts-node src/scripts/veeqoVerifyRates.ts 114-0828046-3183417
 */
async function main(): Promise<void> {
  const num = process.argv[2];
  if (!num) { console.error('amazonOrderNumber gerekli'); process.exit(1); }

  const order = await getOrderByNumber(num);
  if (!order) { console.error('Veeqo order bulunamadı:', num); process.exit(1); }
  const d: any = (order as any).deliver_to || {};
  const items: any[] = (order as any).line_items || [];
  const channel_items = items.filter((li) => li.remote_id).map((li) => ({
    remote_id: String(li.remote_id), quantity: li.quantity ?? 1,
    value: String(li.price_per_unit ?? '0'), currency_code: (order as any).currency_code || 'USD', country_of_manufacture: 'TR',
  }));
  console.log(`order ${num}: status=${(order as any).status} line_items=${items.length} channel_items=${channel_items.length}`);

  const result = await getRates({
    to_address: {
      name: [d.first_name, d.last_name].filter(Boolean).join(' ') || 'Customer',
      phone: d.phone || '0000000000', line1: d.address1 || '', town: d.city || '',
      county: d.state || '', postcode: d.zip || '', country_code: d.country || 'US',
    },
    from_address: {
      name: process.env.VEEQO_SHIP_FROM_NAME || 'MDN LLC', company: 'MDN LLC',
      phone: process.env.VEEQO_SHIP_FROM_PHONE || '+19085551234',
      line1: '142 Belmont Dr, Unit 3, Suite IWA', town: 'SOMERSET', county: 'NJ', postcode: '08873', country_code: 'US',
    },
    parcels: [{ weight: 2, weight_unit: 'lb', length: 12, width: 9, height: 3, dimension_unit: 'in' }],
    customer_reference: num,
    contents: 'Metal Wall Art',
    ...(channel_items.length ? { is_amazon_order: true, channel_items } : {}),
  });

  console.log(`remote_shipment_id=${result.remote_shipment_id} request_token=${result.request_token?.slice(0, 24)}… expires=${result.expires_at}`);
  const sorted = [...result.quotes].sort((a, b) => parseFloat(a.total_charge) - parseFloat(b.total_charge));
  console.log(`quotes=${sorted.length} (ucuzdan):`);
  sorted.slice(0, 8).forEach((q) => console.log(`  ${q.total_charge.padStart(7)}  ${q.service_carrier}  ${q.service_name}  [${q.rate_id.slice(0, 28)}]`));
}

main().then(() => process.exit(0)).catch((e) => { console.error('FATAL:', e.message || e); process.exit(1); });

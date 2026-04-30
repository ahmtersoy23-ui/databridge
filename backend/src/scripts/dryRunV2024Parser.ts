import 'dotenv/config';
import { fetchTransactionsV2024 } from '../services/spApi/transactionsV2';
import { pool } from '../config/database';
import type { MarketplaceConfig } from '../types';

async function main() {
  const credentialId = Number(process.argv[2] || 1);
  const postedAfter = process.argv[3] || '2026-04-22T00:00:00Z';
  const postedBefore = process.argv[4] || '2026-04-30T00:00:00Z';

  const mp: MarketplaceConfig = {
    marketplace_id: 'ATVPDKIKX0DER',
    country_code: 'US',
    channel: 'us',
    warehouse: 'US',
    region: 'NA',
    timezone_offset: -8,
    is_active: true,
    credential_id: credentialId,
  };

  const rows = await fetchTransactionsV2024(mp, new Date(postedAfter), new Date(postedBefore));

  // Aggregate
  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const byMarketplace: Record<string, number> = {};
  const byDate: Record<string, { orders: number; refunds: number; revenue: number }> = {};
  const totals = {
    product_sales: 0, selling_fees: 0, fba_fees: 0,
    other_transaction_fees: 0, other: 0, vat: 0,
    promotional_rebates: 0, total: 0,
  };
  let withoutSku = 0;

  for (const r of rows) {
    byType[r.type] = (byType[r.type] || 0) + 1;
    byStatus[r.transaction_status || 'NULL'] = (byStatus[r.transaction_status || 'NULL'] || 0) + 1;
    byCategory[r.category_type] = (byCategory[r.category_type] || 0) + 1;
    byMarketplace[r.marketplace_code || 'EMPTY'] = (byMarketplace[r.marketplace_code || 'EMPTY'] || 0) + 1;
    if (!r.sku) withoutSku++;

    if (r.category_type === 'Order' || r.category_type === 'Refund') {
      const dt = r.date_only;
      if (!byDate[dt]) byDate[dt] = { orders: 0, refunds: 0, revenue: 0 };
      if (r.category_type === 'Order') {
        byDate[dt].orders++;
        byDate[dt].revenue += r.product_sales;
      } else {
        byDate[dt].refunds++;
      }
    }

    totals.product_sales += r.product_sales;
    totals.selling_fees += r.selling_fees;
    totals.fba_fees += r.fba_fees;
    totals.other_transaction_fees += r.other_transaction_fees;
    totals.other += r.other;
    totals.vat += r.vat;
    totals.promotional_rebates += r.promotional_rebates;
    totals.total += r.total;
  }

  console.log(`\n=== TOTAL ROWS: ${rows.length} ===`);
  console.log('By transactionType:', byType);
  console.log('By status:', byStatus);
  console.log('By category_type (DB):', byCategory);
  console.log('By marketplace_code:', byMarketplace);
  console.log(`Rows without SKU: ${withoutSku}`);

  console.log('\n=== MONEY TOTALS (sum across all rows) ===');
  console.log(JSON.stringify(totals, (_, v) => typeof v === 'number' ? Math.round(v * 100) / 100 : v, 2));

  console.log('\n=== BY DATE (Order/Refund) ===');
  const sortedDates = Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [dt, d] of sortedDates) {
    console.log(`  ${dt}: orders=${d.orders} refunds=${d.refunds} revenue=$${d.revenue.toFixed(2)}`);
  }

  // Sample row (first Shipment/Order)
  const sampleOrder = rows.find(r => r.category_type === 'Order' && r.transaction_status === 'DEFERRED');
  if (sampleOrder) {
    console.log('\n=== SAMPLE DEFERRED Order row ===');
    console.log(JSON.stringify(sampleOrder, null, 2));
  }
  const sampleRefund = rows.find(r => r.category_type === 'Refund');
  if (sampleRefund) {
    console.log('\n=== SAMPLE Refund row ===');
    console.log(JSON.stringify(sampleRefund, null, 2));
  }

  await pool.end();
}

main().catch(err => { console.error('FAILED:', err?.message || err); process.exit(1); });

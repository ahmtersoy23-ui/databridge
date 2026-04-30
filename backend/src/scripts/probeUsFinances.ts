import 'dotenv/config';
import { getSpApiClient } from '../services/spApi/client';
import { pool } from '../config/database';

async function main() {
  const credentialId = 1; // MDN / NA / US
  const postedAfter = process.argv[2] || '2026-04-22T00:00:00Z';
  const postedBefore = process.argv[3] || '2026-04-29T00:00:00Z';

  console.log(`[probe] credential=${credentialId} window=${postedAfter} → ${postedBefore}`);

  const client = await getSpApiClient(credentialId);

  let nextToken: string | undefined;
  let pageCount = 0;
  const totals: Record<string, number> = {};
  const samples: Record<string, any> = {};

  do {
    pageCount++;
    const query: Record<string, string> = {
      PostedAfter: postedAfter,
      PostedBefore: postedBefore,
      MaxResultsPerPage: '100',
    };
    if (nextToken) query.NextToken = nextToken;

    const t0 = Date.now();
    const response: any = await client.callAPI({
      operation: 'listFinancialEvents',
      endpoint: 'finances',
      query,
    });
    const ms = Date.now() - t0;

    const events = response?.FinancialEvents || response;
    const eventListNames = Object.keys(events || {}).filter(k => Array.isArray(events[k]));

    const pageBreakdown: Record<string, number> = {};
    for (const k of eventListNames) {
      const n = events[k].length;
      pageBreakdown[k] = n;
      totals[k] = (totals[k] || 0) + n;
      if (n > 0 && !samples[k]) samples[k] = events[k][0];
    }

    console.log(`[probe] page ${pageCount} (${ms}ms): ${JSON.stringify(pageBreakdown)} nextToken=${response?.NextToken ? 'yes' : 'no'}`);

    nextToken = response?.NextToken;
    if (nextToken) await new Promise(r => setTimeout(r, 600));
  } while (nextToken && pageCount < 50);

  console.log('\n=== TOTALS ===');
  console.log(JSON.stringify(totals, null, 2));

  if (samples.ShipmentEventList) {
    const s = samples.ShipmentEventList;
    console.log('\n=== SAMPLE Shipment ===');
    console.log(JSON.stringify({
      OrderId: s.AmazonOrderId,
      MarketplaceName: s.MarketplaceName,
      PostedDate: s.PostedDate,
      itemCount: s.ShipmentItemList?.length,
    }, null, 2));
  } else {
    console.log('\n!!! NO ShipmentEventList items in window !!!');
  }
  if (samples.RefundEventList) {
    const s = samples.RefundEventList;
    console.log('\n=== SAMPLE Refund ===');
    console.log(JSON.stringify({
      OrderId: s.AmazonOrderId,
      MarketplaceName: s.MarketplaceName,
      PostedDate: s.PostedDate,
    }, null, 2));
  }

  await pool.end();
}

main().catch(err => {
  console.error('[probe] FAILED:', err);
  process.exit(1);
});

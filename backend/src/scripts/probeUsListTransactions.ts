import 'dotenv/config';
import { getSpApiClient } from '../services/spApi/client';
import { pool } from '../config/database';

async function main() {
  const credentialId = 1; // MDN / NA / US
  const postedAfter = process.argv[2] || '2026-04-22T00:00:00Z';
  const postedBefore = process.argv[3] || '2026-04-29T00:00:00Z';
  const marketplaceId = process.argv[4]; // optional, e.g. ATVPDKIKX0DER for US

  console.log(`[probe-v2024] credential=${credentialId} window=${postedAfter} → ${postedBefore} marketplace=${marketplaceId || '(any)'}`);

  const client = await getSpApiClient(credentialId);

  let nextToken: string | undefined;
  let pageCount = 0;
  const statusBreakdown: Record<string, number> = {};
  const typeBreakdown: Record<string, number> = {};
  const deferralReasons: Record<string, number> = {};
  const samples: Record<string, any> = {};

  do {
    pageCount++;
    const query: Record<string, string> = {
      postedAfter,
      postedBefore,
    };
    if (marketplaceId) query.marketplaceId = marketplaceId;
    if (nextToken) query.nextToken = nextToken;

    const t0 = Date.now();
    const response: any = await (client as any).callAPI({
      operation: 'listTransactions',
      endpoint: 'finances',
      query,
    });
    const ms = Date.now() - t0;

    const txList = response?.transactions || [];
    const pageStatus: Record<string, number> = {};

    for (const tx of txList) {
      const status = tx.transactionStatus || 'UNKNOWN';
      const type = tx.transactionType || 'UNKNOWN';
      pageStatus[status] = (pageStatus[status] || 0) + 1;
      statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
      typeBreakdown[type] = (typeBreakdown[type] || 0) + 1;

      const deferralReason = tx.contexts?.find?.((c: any) => c.deferralReason)?.deferralReason
        || tx.deferredContext?.deferralReason
        || (tx.contexts?.[0]?.contextType === 'DeferredContext' ? tx.contexts[0]?.deferralReason : null);
      if (deferralReason) deferralReasons[deferralReason] = (deferralReasons[deferralReason] || 0) + 1;

      const sampleKey = `${type}_${status}`;
      if (!samples[sampleKey]) samples[sampleKey] = tx;
    }

    console.log(`[probe-v2024] page ${pageCount} (${ms}ms): ${txList.length} txs status=${JSON.stringify(pageStatus)} nextToken=${response?.nextToken ? 'yes' : 'no'}`);

    nextToken = response?.nextToken;
    if (nextToken) await new Promise(r => setTimeout(r, 600));
  } while (nextToken && pageCount < 50);

  console.log('\n=== STATUS BREAKDOWN ===');
  console.log(JSON.stringify(statusBreakdown, null, 2));

  console.log('\n=== TYPE BREAKDOWN ===');
  console.log(JSON.stringify(typeBreakdown, null, 2));

  console.log('\n=== DEFERRAL REASONS ===');
  console.log(JSON.stringify(deferralReasons, null, 2));

  console.log('\n=== SAMPLES (first per type+status) ===');
  for (const [key, tx] of Object.entries(samples).slice(0, 5)) {
    console.log(`\n--- ${key} ---`);
    console.log(JSON.stringify(tx, null, 2));
  }

  await pool.end();
}

main().catch(err => {
  console.error('[probe-v2024] FAILED:', err?.message || err);
  if (err?.stack) console.error(err.stack);
  process.exit(1);
});

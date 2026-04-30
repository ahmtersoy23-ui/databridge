import 'dotenv/config';
import { getSpApiClient } from '../services/spApi/client';
import { pool } from '../config/database';
import * as fs from 'fs';

async function main() {
  const credentialId = Number(process.argv[2] || 1);
  const postedAfter = process.argv[3] || '2026-04-22T00:00:00Z';
  const postedBefore = process.argv[4] || '2026-04-30T00:00:00Z';
  const marketplaceId = process.argv[5];

  console.log(`[schema] credential=${credentialId} window=${postedAfter}→${postedBefore} marketplace=${marketplaceId || '(any)'}`);

  const client = await getSpApiClient(credentialId);

  let nextToken: string | undefined;
  let pageCount = 0;
  const breakdownTypesByTop: Record<string, Set<string>> = {};
  const breakdownTypesByPath: Record<string, number> = {};
  const itemIdentifierNames: Record<string, number> = {};
  const txIdentifierNames: Record<string, number> = {};
  const contextTypes: Record<string, number> = {};
  const samples: Record<string, any> = {};
  const txCount: Record<string, number> = {};

  function walkBreakdowns(arr: any[], path: string) {
    if (!Array.isArray(arr)) return;
    for (const b of arr) {
      const t = b.breakdownType || 'UNKNOWN';
      const fullPath = path ? `${path}>${t}` : t;
      breakdownTypesByPath[fullPath] = (breakdownTypesByPath[fullPath] || 0) + 1;
      if (Array.isArray(b.breakdowns) && b.breakdowns.length) {
        walkBreakdowns(b.breakdowns, fullPath);
      }
    }
  }

  do {
    pageCount++;
    const query: Record<string, string> = { postedAfter, postedBefore };
    if (marketplaceId) query.marketplaceId = marketplaceId;
    if (nextToken) query.nextToken = nextToken;

    const response: any = await (client as any).callAPI({
      operation: 'listTransactions', endpoint: 'finances', query,
    });

    const txList = response?.transactions || [];

    for (const tx of txList) {
      const type = tx.transactionType || 'UNKNOWN';
      const status = tx.transactionStatus || 'UNKNOWN';
      const key = `${type}_${status}`;
      txCount[key] = (txCount[key] || 0) + 1;

      walkBreakdowns(tx.breakdowns || [], type);
      if (!breakdownTypesByTop[type]) breakdownTypesByTop[type] = new Set();
      for (const b of tx.breakdowns || []) breakdownTypesByTop[type].add(b.breakdownType);

      for (const id of tx.relatedIdentifiers || []) {
        txIdentifierNames[id.relatedIdentifierName] = (txIdentifierNames[id.relatedIdentifierName] || 0) + 1;
      }

      for (const ctx of tx.contexts || []) {
        contextTypes[ctx.contextType || 'UNKNOWN'] = (contextTypes[ctx.contextType || 'UNKNOWN'] || 0) + 1;
      }

      for (const item of tx.items || []) {
        for (const id of item.relatedIdentifiers || []) {
          itemIdentifierNames[id.itemRelatedIdentifierName] = (itemIdentifierNames[id.itemRelatedIdentifierName] || 0) + 1;
        }
        walkBreakdowns(item.breakdowns || [], `${type}.item`);
        for (const ctx of item.contexts || []) {
          contextTypes[`item.${ctx.contextType || 'UNKNOWN'}`] = (contextTypes[`item.${ctx.contextType || 'UNKNOWN'}`] || 0) + 1;
        }
      }

      if (!samples[key]) samples[key] = tx;
    }

    nextToken = response?.nextToken;
    if (nextToken) await new Promise(r => setTimeout(r, 600));
  } while (nextToken && pageCount < 50);

  const out = {
    pageCount,
    txCount,
    txIdentifierNames,
    itemIdentifierNames,
    contextTypes,
    breakdownTypesByTop: Object.fromEntries(Object.entries(breakdownTypesByTop).map(([k, v]) => [k, [...v]])),
    breakdownTypesByPath,
    samples,
  };

  const outPath = `/tmp/v2024_schema_${credentialId}.json`;
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  console.log('\n=== TX COUNT ===');
  console.log(JSON.stringify(txCount, null, 2));
  console.log('\n=== TX IDENTIFIER NAMES ===');
  console.log(JSON.stringify(txIdentifierNames, null, 2));
  console.log('\n=== ITEM IDENTIFIER NAMES ===');
  console.log(JSON.stringify(itemIdentifierNames, null, 2));
  console.log('\n=== CONTEXT TYPES ===');
  console.log(JSON.stringify(contextTypes, null, 2));
  console.log('\n=== BREAKDOWN TYPES BY TOP ===');
  console.log(JSON.stringify(out.breakdownTypesByTop, null, 2));
  console.log('\n=== BREAKDOWN PATHS (top 30) ===');
  console.log(JSON.stringify(Object.fromEntries(Object.entries(breakdownTypesByPath).sort((a, b) => b[1] - a[1]).slice(0, 30)), null, 2));
  console.log(`\nFull dump → ${outPath}`);

  await pool.end();
}

main().catch(err => { console.error('FAILED:', err?.message || err); process.exit(1); });

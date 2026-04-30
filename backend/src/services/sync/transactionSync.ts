import { pool } from '../../config/database';
import { fetchSettlementTransactions } from '../spApi/transactions';
import { fetchTransactionsV2024 } from '../spApi/transactionsV2';
import logger from '../../config/logger';
import { TRANSACTION_OVERLAP_DAYS } from '../../config/constants';
import type { MarketplaceConfig } from '../../types';
import type { FinancialTransaction } from '../../types';

export async function syncTransactionsForMarketplace(
  marketplace: MarketplaceConfig,
  daysBack: number = TRANSACTION_OVERLAP_DAYS
): Promise<number> {
  const jobId = await createSyncJob('transaction_sync', marketplace.country_code);

  try {
    await updateSyncJob(jobId, 'running');

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    // Fetch from Finances API v2024-06-19 listTransactions (RELEASED + DEFERRED).
    // Replaces v0 listFinancialEvents which stopped returning DD+7 deferred shipments
    // after Amazon's 2026-04 transaction-level reserve rollout.
    const financesTransactions = await fetchTransactionsV2024(marketplace, startDate, endDate);

    // Fetch from Settlement Reports (FBA Inventory Fee, Shipping Services, etc.)
    let settlementTransactions: FinancialTransaction[] = [];
    try {
      settlementTransactions = await fetchSettlementTransactions(marketplace, startDate);
    } catch (err: any) {
      logger.warn(`[Sync] Settlement report fetch failed for ${marketplace.country_code}: ${err.message}`);
    }

    const allTransactions = [...financesTransactions, ...settlementTransactions];
    if (allTransactions.length === 0) {
      await updateSyncJob(jobId, 'completed', 0);
      return 0;
    }

    await upsertTransactions(allTransactions);

    await updateSyncJob(jobId, 'completed', allTransactions.length);
    logger.info(`[Sync] Transaction sync completed for ${marketplace.country_code}: ${financesTransactions.length} finances + ${settlementTransactions.length} settlement = ${allTransactions.length} total`);
    return allTransactions.length;
  } catch (err: any) {
    logger.error(`[Sync] Transaction sync failed for ${marketplace.country_code}:`, err.message);
    await updateSyncJob(jobId, 'failed', 0, err.message);
    throw err;
  }
}

export async function backfillTransactions(marketplace: MarketplaceConfig, months: number = 18): Promise<number> {
  const jobId = await createSyncJob('transaction_backfill', marketplace.country_code);
  await updateSyncJob(jobId, 'running');

  logger.info(`[Sync] Starting transaction backfill for ${marketplace.country_code}: ${months} months`);

  let totalTransactions = 0;
  const now = new Date();

  for (let m = months - 1; m >= 0; m--) {
    const endDate = new Date(now);
    endDate.setMonth(endDate.getMonth() - m);

    const startDate = new Date(endDate);
    startDate.setMonth(startDate.getMonth() - 1);

    try {
      const transactions = await fetchTransactionsV2024(marketplace, startDate, endDate);

      if (transactions.length > 0) {
        await upsertTransactions(transactions);
      }

      totalTransactions += transactions.length;
      logger.info(`[Sync] Transaction backfill ${months - m}/${months} (${startDate.toISOString().split('T')[0]} → ${endDate.toISOString().split('T')[0]}): ${transactions.length} transactions`);

      // Wait between months to respect rate limits
      if (m > 0) await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (err: any) {
      logger.error(`[Sync] Transaction backfill month ${months - m}/${months} failed for ${marketplace.country_code}: ${err.message}`);
      // Continue with next month
    }
  }

  await updateSyncJob(jobId, 'completed', totalTransactions);
  logger.info(`[Sync] Transaction backfill completed for ${marketplace.country_code}: ${totalTransactions} total`);
  return totalTransactions;
}

async function upsertTransactions(transactions: FinancialTransaction[]): Promise<void> {
  // Deduplicate by transaction_id within batch (keep last occurrence)
  const seen = new Map<string, FinancialTransaction>();
  for (const t of transactions) {
    seen.set(t.transaction_id, t);
  }
  const deduped = Array.from(seen.values());

  const BATCH_SIZE = 100;

  const COL_COUNT = 27;

  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    const batch = deduped.slice(i, i + BATCH_SIZE);
    const values: string[] = [];
    const params: any[] = [];

    batch.forEach((t, idx) => {
      const offset = idx * COL_COUNT;
      const placeholders = Array.from({ length: COL_COUNT }, (_, j) => `$${offset + j + 1}`);
      values.push(`(${placeholders.join(', ')})`);
      params.push(
        t.transaction_id, t.file_name, t.transaction_date, t.date_only,
        t.type, t.category_type, t.order_id, t.sku, t.description,
        t.marketplace, t.marketplace_code, t.fulfillment, t.order_postal,
        t.quantity, t.product_sales, t.promotional_rebates, t.selling_fees,
        t.fba_fees, t.other_transaction_fees, t.other, t.vat,
        t.liquidations, t.total, t.credential_id,
        t.transaction_status ?? null,
        t.maturity_date ?? null,
        t.deferral_reason ?? null
      );
    });

    await pool.query(`
      INSERT INTO financial_transactions (
        transaction_id, file_name, transaction_date, date_only,
        type, category_type, order_id, sku, description,
        marketplace, marketplace_code, fulfillment, order_postal,
        quantity, product_sales, promotional_rebates, selling_fees,
        fba_fees, other_transaction_fees, other, vat,
        liquidations, total, credential_id,
        transaction_status, maturity_date, deferral_reason
      ) VALUES ${values.join(', ')}
      ON CONFLICT (transaction_id) DO UPDATE SET
        file_name = EXCLUDED.file_name,
        transaction_date = EXCLUDED.transaction_date,
        date_only = EXCLUDED.date_only,
        type = EXCLUDED.type,
        category_type = EXCLUDED.category_type,
        order_id = EXCLUDED.order_id,
        sku = EXCLUDED.sku,
        description = EXCLUDED.description,
        marketplace = EXCLUDED.marketplace,
        marketplace_code = EXCLUDED.marketplace_code,
        fulfillment = EXCLUDED.fulfillment,
        order_postal = EXCLUDED.order_postal,
        quantity = EXCLUDED.quantity,
        product_sales = EXCLUDED.product_sales,
        promotional_rebates = EXCLUDED.promotional_rebates,
        selling_fees = EXCLUDED.selling_fees,
        fba_fees = EXCLUDED.fba_fees,
        other_transaction_fees = EXCLUDED.other_transaction_fees,
        other = EXCLUDED.other,
        vat = EXCLUDED.vat,
        liquidations = EXCLUDED.liquidations,
        total = EXCLUDED.total,
        credential_id = EXCLUDED.credential_id,
        transaction_status = EXCLUDED.transaction_status,
        maturity_date = EXCLUDED.maturity_date,
        deferral_reason = EXCLUDED.deferral_reason,
        synced_at = NOW()
    `, params);
  }
}

async function createSyncJob(jobType: string, marketplace: string): Promise<number> {
  const result = await pool.query(
    'INSERT INTO sync_jobs (job_type, marketplace, status) VALUES ($1, $2, $3) RETURNING id',
    [jobType, marketplace, 'pending']
  );
  return result.rows[0].id;
}

async function updateSyncJob(
  id: number,
  status: string,
  recordsProcessed?: number,
  errorMessage?: string
): Promise<void> {
  const fields = ['status = $2'];
  const params: any[] = [id, status];
  let idx = 3;

  if (status === 'running') fields.push('started_at = NOW()');
  if (status === 'completed' || status === 'failed') fields.push('completed_at = NOW()');

  if (recordsProcessed !== undefined) {
    fields.push(`records_processed = $${idx}`);
    params.push(recordsProcessed);
    idx++;
  }
  if (errorMessage) {
    fields.push(`error_message = $${idx}`);
    params.push(errorMessage);
    idx++;
  }

  await pool.query(`UPDATE sync_jobs SET ${fields.join(', ')} WHERE id = $1`, params);
}

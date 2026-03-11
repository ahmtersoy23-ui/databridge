import { pool, sharedPool } from '../../config/database';
import logger from '../../config/logger';

const BATCH_SIZE = 200;

/**
 * Write current month's Order/Refund transactions from financial_transactions (databridge_db)
 * to amz_transactions (pricelab_db) for AmzSellMetrics consumption.
 *
 * - Only writes Order + Refund category_types
 * - Only writes current month data
 * - Uses file_name='sp-api-sync' to distinguish from Excel uploads
 * - ON CONFLICT updates existing sp-api-sync rows; never touches Excel data
 */
export async function writeTransactionData(): Promise<void> {
  const startTime = Date.now();

  // Current month boundaries
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

  logger.info(`[TransactionData] Writing Order/Refund to amz_transactions (${monthStart} → ${monthEnd})...`);

  // Read current month Order/Refund from databridge_db
  const result = await pool.query(`
    SELECT transaction_id, transaction_date, date_only, type, category_type,
           order_id, sku, description, marketplace, marketplace_code,
           fulfillment, order_postal, quantity,
           product_sales, promotional_rebates, selling_fees, fba_fees,
           other_transaction_fees, other, vat, liquidations, total
    FROM financial_transactions
    WHERE category_type IN ('Order', 'Refund')
      AND date_only BETWEEN $1 AND $2
      AND marketplace_code != ''
    ORDER BY date_only
  `, [monthStart, monthEnd]);

  const rows = result.rows;
  if (rows.length === 0) {
    logger.info('[TransactionData] No Order/Refund rows for current month');
    return;
  }

  const client = await sharedPool.connect();
  try {
    await client.query('BEGIN');

    // Delete existing sp-api-sync rows for current month (clean refresh)
    const delResult = await client.query(
      `DELETE FROM amz_transactions WHERE file_name = 'sp-api-sync' AND date_only BETWEEN $1 AND $2`,
      [monthStart, monthEnd]
    );
    logger.info(`[TransactionData] Deleted ${delResult.rowCount} existing sp-api-sync rows`);

    // Batch insert
    let written = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const values: string[] = [];
      const params: any[] = [];

      batch.forEach((t: any, idx: number) => {
        const offset = idx * 22;
        const placeholders = Array.from({ length: 22 }, (_, j) => `$${offset + j + 1}`);
        values.push(`(${placeholders.join(', ')})`);
        params.push(
          t.transaction_id, 'sp-api-sync', t.transaction_date, t.date_only,
          t.type, t.category_type, t.order_id, t.sku, t.description,
          t.marketplace, t.fulfillment, t.order_postal, t.quantity || 0,
          t.product_sales || 0, t.promotional_rebates || 0, t.selling_fees || 0,
          t.fba_fees || 0, t.other_transaction_fees || 0, t.other || 0,
          t.vat || 0, t.liquidations || 0, t.total || 0
        );
      });

      await client.query(`
        INSERT INTO amz_transactions (
          transaction_id, file_name, transaction_date, date_only,
          type, category_type, order_id, sku, description,
          marketplace, fulfillment, order_postal, quantity,
          product_sales, promotional_rebates, selling_fees, fba_fees,
          other_transaction_fees, other, vat, liquidations, total
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
          total = EXCLUDED.total
      `, params);

      written += batch.length;
    }

    await client.query('COMMIT');

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`[TransactionData] Written ${written} Order/Refund rows to amz_transactions, ${elapsed}s`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Clean up old data from financial_transactions.
 * Keeps last 35 days to allow buffer at month boundaries.
 */
export async function cleanupOldTransactions(): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 35);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const result = await pool.query(
    `DELETE FROM financial_transactions WHERE date_only < $1`,
    [cutoffStr]
  );

  if (result.rowCount && result.rowCount > 0) {
    logger.info(`[TransactionData] Cleaned up ${result.rowCount} rows older than 35 days from financial_transactions`);
  }
}

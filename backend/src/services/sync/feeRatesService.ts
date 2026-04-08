import { sharedPool } from '../../config/database';
import logger from '../../config/logger';

/**
 * Calculate product-level fee rates from amz_transactions (L180).
 * Groups by sku_master.name — same product across SKUs gets one rate.
 * Ads excluded (AdPilot has its own ads data).
 * Result written to pricelab_db.product_fee_rates for AdPilot to read.
 */
export async function calculateProductFeeRates(): Promise<number> {
  // L180: last 6 months ending at previous month's last day
  const now = new Date();
  const periodEnd = new Date(now.getUTCFullYear(), now.getUTCMonth(), 0); // last day of prev month
  const periodStart = new Date(periodEnd);
  periodStart.setUTCMonth(periodStart.getUTCMonth() - 5);
  periodStart.setUTCDate(1); // first day, 6 months back

  const startStr = periodStart.toISOString().split('T')[0];
  const endStr = periodEnd.toISOString().split('T')[0];

  logger.info(`[FeeRates] Calculating L180 fee rates: ${startStr} → ${endStr}`);

  // Step 1: Calculate global FBA overhead rate (non-name-specific costs)
  logger.info('[FeeRates] Step 1: Calculating global FBA overhead...');
  const globalResult = await sharedPool.query(`
    SELECT
      ROUND(ABS(SUM(CASE WHEN t.type IN (
        'Adjustment', 'FBA Inventory Fee', 'FBA Transaction fees',
        'SAFE-T reimbursement', 'Chargeback Refund', 'FBA Customer Return Fee'
      ) THEN t.total ELSE 0 END))
      / NULLIF(SUM(CASE WHEN t.type = 'Order' AND sm.fulfillment = 'FBA' THEN t.product_sales ELSE 0 END), 0)
      * 100, 2) as fba_cost_pct
    FROM amz_transactions t
    JOIN sku_master sm ON t.sku = sm.sku AND sm.country_code = 'US'
    WHERE t.marketplace_code = 'US'
      AND t.date_only >= $1 AND t.date_only <= $2
  `, [startStr, endStr]);

  const globalFbaCostPct = parseFloat(globalResult.rows[0]?.fba_cost_pct || '0');
  logger.info(`[FeeRates] Global FBA cost: ${globalFbaCostPct}%`);

  // Step 2: Calculate name-level fee rates
  logger.info('[FeeRates] Step 2: Calculating name-level rates...');
  const result = await sharedPool.query(`
    SELECT
      sm.name as product_name,
      CASE
        WHEN COUNT(DISTINCT sm.fulfillment) > 1 THEN 'Mixed'
        ELSE MAX(sm.fulfillment)
      END as fulfillment,
      COUNT(DISTINCT t.sku) as sku_count,
      COUNT(CASE WHEN t.type = 'Order' THEN 1 END) as order_count,
      COALESCE(SUM(CASE WHEN t.type = 'Order' THEN t.product_sales ELSE 0 END), 0) as revenue,
      ROUND(ABS(SUM(CASE WHEN t.type = 'Order' THEN t.selling_fees ELSE 0 END))
        / NULLIF(SUM(CASE WHEN t.type = 'Order' THEN t.product_sales ELSE 0 END), 0) * 100, 2) as selling_fee_pct,
      ROUND(ABS(SUM(CASE WHEN t.type = 'Order' AND sm.fulfillment = 'FBA' THEN t.fba_fees ELSE 0 END))
        / NULLIF(SUM(CASE WHEN t.type = 'Order' AND sm.fulfillment = 'FBA' THEN t.product_sales ELSE 0 END), 0) * 100, 2) as fba_fee_pct,
      ROUND(ABS(SUM(CASE WHEN t.type = 'Refund' THEN t.total ELSE 0 END)) * 0.50
        / NULLIF(SUM(CASE WHEN t.type = 'Order' THEN t.product_sales ELSE 0 END), 0) * 100, 2) as refund_loss_pct,
      ROUND(ABS(SUM(CASE WHEN t.type = 'Order' THEN t.other_transaction_fees ELSE 0 END))
        / NULLIF(SUM(CASE WHEN t.type = 'Order' THEN t.product_sales ELSE 0 END), 0) * 100, 2) as other_fee_pct
    FROM amz_transactions t
    JOIN sku_master sm ON t.sku = sm.sku AND sm.country_code = 'US'
    WHERE t.marketplace_code = 'US'
      AND t.date_only >= $1 AND t.date_only <= $2
      AND sm.name IS NOT NULL AND sm.name != ''
    GROUP BY sm.name
    HAVING SUM(CASE WHEN t.type = 'Order' THEN t.product_sales ELSE 0 END) > 0
    ORDER BY revenue DESC
  `, [startStr, endStr]);

  if (!result.rows.length) {
    logger.warn('[FeeRates] No data found for period');
    return 0;
  }

  logger.info(`[FeeRates] Calculated rates for ${result.rows.length} products`);

  // Step 3: Write to product_fee_rates (truncate + insert for clean refresh)
  const client = await sharedPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM product_fee_rates WHERE marketplace_code = $1', ['US']);

    const COLS = 13;
    const BATCH = 50;
    for (let i = 0; i < result.rows.length; i += BATCH) {
      const batch = result.rows.slice(i, i + BATCH);
      const values: any[] = [];
      const placeholders: string[] = [];

      for (let j = 0; j < batch.length; j++) {
        const r = batch[j];
        const off = j * COLS;
        placeholders.push(`(${Array.from({ length: COLS }, (_, k) => `$${off + k + 1}`).join(', ')}, NOW())`);
        values.push(
          r.product_name, 'US', r.fulfillment,
          r.sku_count, r.order_count, r.revenue,
          r.selling_fee_pct, r.fba_fee_pct, r.refund_loss_pct,
          globalFbaCostPct, r.other_fee_pct,
          startStr, endStr,
        );
      }

      await client.query(`
        INSERT INTO product_fee_rates (
          product_name, marketplace_code, fulfillment,
          sku_count, order_count, revenue,
          selling_fee_pct, fba_fee_pct, refund_loss_pct,
          fba_cost_pct, other_fee_pct,
          period_start, period_end, calculated_at
        ) VALUES ${placeholders.join(', ')}
        ON CONFLICT (product_name, marketplace_code)
        DO UPDATE SET
          fulfillment = EXCLUDED.fulfillment,
          sku_count = EXCLUDED.sku_count,
          order_count = EXCLUDED.order_count,
          revenue = EXCLUDED.revenue,
          selling_fee_pct = EXCLUDED.selling_fee_pct,
          fba_fee_pct = EXCLUDED.fba_fee_pct,
          refund_loss_pct = EXCLUDED.refund_loss_pct,
          fba_cost_pct = EXCLUDED.fba_cost_pct,
          other_fee_pct = EXCLUDED.other_fee_pct,
          period_start = EXCLUDED.period_start,
          period_end = EXCLUDED.period_end,
          calculated_at = NOW()
      `, values);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  logger.info(`[FeeRates] Written ${result.rows.length} product fee rates`);
  return result.rows.length;
}

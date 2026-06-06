import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/database';
import { validateBody } from '../middleware/validate';
import { adminOpsAuth } from '../middleware/adminOps';
import {
  getRates, bookShipment, getLabel, cancelShipment, getOrderByNumber,
  VeeqoAddress, VeeqoParcel,
} from '../services/veeqo/client';
import logger from '../config/logger';

/**
 * Veeqo Rate Shopping routing — ManuMaestro (server-to-server, x-internal-api-key)
 * veya admin UI çağırır. Veeqo ile konuşan TEK yer DataBridge.
 *
 *   POST /veeqo-routing/rates  { amazonOrderNumber, parcel } → quotes[] + remote_shipment_id + request_token
 *   POST /veeqo-routing/book   { remoteShipmentId, rateId, requestToken } → tracking + label(base64) — GERÇEK PARA
 *   POST /veeqo-routing/cancel { shipmentId } → iptal (test/yanlış etiket)
 *
 * Cheapest seçimi UI'da operatör onayıyla (memory kararı) — route ham quotes döner.
 * is_amazon_order + channel_items: booking tracking'i otomatik Amazon Seller Central'a
 * yazar + "shipped" yapar + Buy Shipping koruması → Wisersell external-close gereksizleşir.
 */

const router = Router();
router.use(adminOpsAuth);

async function auditLog(jobName: string, status: 'success' | 'failed', rows: number, error?: string): Promise<void> {
  await pool.query(
    `INSERT INTO sync_log (job_name, status, rows_processed, error_message, finished_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [jobName, status, rows, error?.slice(0, 500) ?? null],
  ).catch(() => { /* audit log hatası akışı bozmasın */ });
}

/** Sevkiyat çıkış (ShipFrom) adresleri — depo bazlı. Amazon ShipFrom için US-format
 *  telefon ŞART (TR telefonu reddedilir): VEEQO_SHIP_FROM_PHONE.
 *  warehouseCode 'NJ' → Somerset, 'SHOWROOM' → Fairfield. */
function getShipFrom(warehouse?: string): VeeqoAddress {
  const phone = process.env.VEEQO_SHIP_FROM_PHONE;
  if (!phone) throw new Error('VEEQO_SHIP_FROM_PHONE yapılandırılmamış (Amazon ShipFrom için geçerli US telefon gerekli)');
  if (warehouse === 'SHOWROOM') {
    return { name: 'MDN LLC FAIRFIELD', company: 'MDN LLC', phone, line1: '16A Spielman Road', town: 'FAIRFIELD', county: 'NJ', postcode: '07004', country_code: 'US' };
  }
  // default = Somerset (NJ)
  return { name: 'MDN LLC', company: 'MDN LLC', phone, line1: '142 Belmont Dr, Unit 3, Suite IWA', town: 'SOMERSET', county: 'NJ', postcode: '08873', country_code: 'US' };
}

/** Veeqo order.deliver_to → VeeqoAddress (to_address). */
function toAddressFromOrder(order: Record<string, any>): VeeqoAddress {
  const d = order.deliver_to || {};
  const name = [d.first_name, d.last_name].filter(Boolean).join(' ').trim() || d.company || 'Customer';
  return {
    name,
    company: d.company || undefined,
    phone: d.phone || '0000000000',
    email: d.email || undefined,
    line1: d.address1 || '',
    line2: d.address2 || undefined,
    town: d.city || '',
    county: d.state || '',
    postcode: d.zip || '',
    country_code: d.country || 'US',
  };
}

/** Veeqo order.line_items → channel_items (Amazon Buy Shipping + auto-push). */
function channelItemsFromOrder(order: Record<string, any>): unknown[] {
  const items = order.line_items || order.lineItems || [];
  return items
    .filter((li: any) => li.remote_id)
    .map((li: any) => ({
      remote_id: String(li.remote_id),
      quantity: li.quantity ?? 1,
      value: String(li.price_per_unit ?? li.taxless_discount_per_unit ?? '0'),
      currency_code: order.currency_code || 'USD',
      country_of_manufacture: 'TR',
    }));
}

// ---- POST /rates ----
const parcelSchema = z.object({
  weight: z.number().positive(),
  weight_unit: z.enum(['lb', 'kg', 'oz', 'g']).default('lb'),
  length: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  dimension_unit: z.enum(['in', 'cm']).default('in'),
});

const ratesSchema = z.object({
  amazonOrderNumber: z.string().min(3),
  parcel: parcelSchema,
  contents: z.string().max(120).optional(),
  /** 'NJ' → Somerset, 'SHOWROOM' → Fairfield ship-from */
  warehouse: z.string().optional(),
  /** false → düz domestic quote (Amazon push YOK); default true (Buy Shipping + auto-push) */
  isAmazonOrder: z.boolean().default(true),
});

router.post('/rates', validateBody(ratesSchema), async (req: Request, res: Response) => {
  const { amazonOrderNumber, parcel, contents, warehouse, isAmazonOrder } = req.body as {
    amazonOrderNumber: string; parcel: VeeqoParcel; contents?: string; warehouse?: string; isAmazonOrder: boolean;
  };
  try {
    const order = await getOrderByNumber(amazonOrderNumber);
    if (!order) {
      return res.status(404).json({ success: false, error: `Veeqo'da sipariş bulunamadı: ${amazonOrderNumber}` });
    }
    const channelItems = channelItemsFromOrder(order);
    const result = await getRates({
      to_address: toAddressFromOrder(order),
      from_address: getShipFrom(warehouse),
      parcels: [parcel],
      customer_reference: amazonOrderNumber,
      contents: contents || 'Metal Wall Art',
      ...(isAmazonOrder && channelItems.length ? { is_amazon_order: true, channel_items: channelItems } : {}),
    });
    // UI'a sade quote listesi (ucuzdan pahalıya)
    const quotes = (result.quotes || [])
      .map((q) => ({
        rate_id: q.rate_id,
        service_name: q.service_name,
        service_carrier: q.service_carrier,
        total_charge: q.total_charge,
        delivery_estimate: q.delivery_estimate,
      }))
      .sort((a, b) => parseFloat(a.total_charge) - parseFloat(b.total_charge));
    await auditLog('veeqo-routing-rates', 'success', quotes.length);
    res.json({
      success: true,
      remoteShipmentId: result.remote_shipment_id,
      requestToken: result.request_token,
      expiresAt: result.expires_at,
      quotes,
    });
  } catch (err: any) {
    await auditLog('veeqo-routing-rates', 'failed', 0, err.message);
    logger.error('[VeeqoRouting] rates error:', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// ---- POST /book (GERÇEK PARA) ----
const bookSchema = z.object({
  remoteShipmentId: z.string().min(3),
  rateId: z.string().min(3),
  requestToken: z.string().optional(),
  labelFormat: z.enum(['PDF', 'PNG', 'ZPL', 'JPEG']).default('PDF'),
});

router.post('/book', validateBody(bookSchema), async (req: Request, res: Response) => {
  const { remoteShipmentId, rateId, requestToken, labelFormat } = req.body as {
    remoteShipmentId: string; rateId: string; requestToken?: string; labelFormat: 'PDF' | 'PNG' | 'ZPL' | 'JPEG';
  };
  try {
    const result = await bookShipment({ remoteShipmentId, rateId, requestToken, labelFormat });
    const ok = result.successful?.[remoteShipmentId];
    if (!ok) {
      const fail = result.failed?.[remoteShipmentId];
      const msg = fail?.error_messages?.join('; ') || 'Veeqo booking başarısız (successful boş)';
      await auditLog('veeqo-routing-book', 'failed', 0, msg);
      return res.status(502).json({ success: false, error: msg });
    }
    const shipmentId = (ok as any).id || (ok as any).shipment_id || remoteShipmentId;
    // label: book response'unda base64 gelmezse get-label ile çek
    let labelBase64 = ok.label;
    if (!labelBase64) {
      const fmt = labelFormat.toLowerCase() as 'pdf' | 'png' | 'zpl' | 'jpeg';
      labelBase64 = (await getLabel(String(shipmentId), fmt)).toString('base64');
    }
    await auditLog('veeqo-routing-book', 'success', 1);
    logger.info(`[VeeqoRouting] book OK: tracking=${ok.tracking_number} service=${ok.service_name}`);
    res.json({
      success: true,
      shipmentId: String(shipmentId),
      trackingNumber: ok.tracking_number,
      serviceName: ok.service_name,
      serviceCarrier: ok.service_carrier,
      totalCharge: ok.total_charge,
      labelBase64,
      labelFormat,
    });
  } catch (err: any) {
    await auditLog('veeqo-routing-book', 'failed', 0, err.message);
    logger.error('[VeeqoRouting] book error:', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// ---- POST /cancel ----
const cancelSchema = z.object({ shipmentId: z.string().min(3) });

router.post('/cancel', validateBody(cancelSchema), async (req: Request, res: Response) => {
  const { shipmentId } = req.body as { shipmentId: string };
  try {
    await cancelShipment(shipmentId);
    await auditLog('veeqo-routing-cancel', 'success', 1);
    res.json({ success: true });
  } catch (err: any) {
    await auditLog('veeqo-routing-cancel', 'failed', 0, err.message);
    logger.error('[VeeqoRouting] cancel error:', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

export default router;

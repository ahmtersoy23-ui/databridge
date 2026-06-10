import { Router, Request, Response } from 'express';
import { errMessage } from '../utils/errors';
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

async function auditLog(jobName: string, status: 'success' | 'failed', rows: number, error?: string, detail?: string): Promise<void> {
  await pool.query(
    `INSERT INTO sync_log (job_name, status, rows_processed, error_message, detail, finished_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [jobName, status, rows, error?.slice(0, 500) ?? null, detail?.slice(0, 300) ?? null],
  ).catch(() => { /* audit log hatası akışı bozmasın */ });
}

/**
 * Veeqo "over-fulfill" hatası (errorCode SINGLE_PURCHASE_VALIDATION_RATE): siparişte
 * takılı/yarım kalmış bir shipment varken yeni book reddedilir. Ham mesaj kriptik →
 * operatöre net aksiyon ver + takılı shipment id'yi ayıkla. Eşleşmezse null (ham kullanılır).
 * (Bu shipment çoğunlukla ücretsiz/yarım bir RS draft'ıdır; API'den silinemeyebilir →
 *  Veeqo panelinden iptal gerekir. 2026-06-08 vakası: order 114-1536594-4934616 / 7d556ec4.)
 */
export function overFulfillMessage(raw: string): string | null {
  if (!/SINGLE_PURCHASE_VALIDATION_RATE|over-?fulfill|Existing shipmentIds/i.test(raw)) return null;
  const m = raw.match(/Existing shipmentIds for order:\s*\[([^\]]+)\]/i);
  const ids = m ? m[1].trim() : null;
  return `Veeqo'da bu siparişte takılı/tamamlanmamış bir shipment var${ids ? ` (${ids})` : ''} → yeni etiket alınamıyor (over-fulfill). Genelde ücretsiz/yarım kalmış bir kayıttır. Çöz: Veeqo panelinden siparişteki shipment'ı iptal edip tekrar dene; ya da etiketi Amazon Buy Shipping / manuel al. Takılı kalırsa Veeqo support'a shipment id ile bildir.`;
}

/** Sevkiyat çıkış (ShipFrom) adresleri — depo bazlı. Amazon ShipFrom için US-format
 *  telefon ŞART (TR telefonu reddedilir): VEEQO_SHIP_FROM_PHONE.
 *  warehouseCode 'NJ' → Somerset, 'SHOWROOM' → Fairfield. */
function getShipFrom(warehouse?: string): VeeqoAddress {
  const phone = process.env.VEEQO_SHIP_FROM_PHONE;
  if (!phone) throw new Error('VEEQO_SHIP_FROM_PHONE yapılandırılmamış (Amazon ShipFrom için geçerli US telefon gerekli)');
  if (warehouse === 'SHOWROOM') {
    return { name: 'MDN LLC FAIRFIELD', company: 'MDN LLC', phone, line1: '16 Spielman Road', town: 'FAIRFIELD', county: 'NJ', postcode: '07004', country_code: 'US' };
  }
  // default = Somerset (NJ)
  return { name: 'MDN LLC', company: 'MDN LLC', phone, line1: '142 Belmont Dr, Unit 3, Suite IWA', town: 'SOMERSET', county: 'NJ', postcode: '08873', country_code: 'US' };
}

/**
 * Telefonu taşıyıcı/etiket üretimi için temizler. Amazon relay telefonları
 * "+1 347-448-3190 ext. 59392" gibi gelir; uzantı + boşluk/tire taşıyıcının etiket
 * DOSYASI üretimini patlatabilir ("There was an error in generating the file" → getLabel 404,
 * shipment yine de oluşur → sahipsiz etiket). Uzantıyı at, yalnız +<rakam> bırak.
 * Geçerli numara çıkmazsa placeholder (Veeqo phone zorunlu alan).
 */
export function cleanPhone(raw?: string | null): string {
  if (!raw) return '0000000000';
  const noExt = raw.replace(/\s*(ext\.?|extension|x)\s*\d+\s*$/i, '').trim();
  const digits = noExt.replace(/\D/g, '');
  if (digits.length < 7) return '0000000000';
  return (noExt.trim().startsWith('+') ? '+' : '') + digits;
}

/** Veeqo order.deliver_to → VeeqoAddress (to_address). */
function toAddressFromOrder(order: Record<string, any>): VeeqoAddress {
  const d = order.deliver_to || {};
  const name = [d.first_name, d.last_name].filter(Boolean).join(' ').trim() || d.company || 'Customer';
  return {
    name,
    company: d.company || undefined,
    phone: cleanPhone(d.phone),
    // deliver_to.email genelde boş (Amazon) → customer.email relay adresine düş (taşıyıcı boş email'de etiket üretemeyebilir).
    email: d.email || order.customer?.email || undefined,
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

/**
 * Bir quote için booking'de gönderilmesi gereken value-added-service değerlerini çözer.
 * Bazı servisler (UPS Ground vb.) "Delivery Confirmation" seçimini ZORUNLU tutar →
 * göndermezsek INVALID_VALUE_ADDED_SERVICES. Her `value_added_service__*` select için
 * ÜCRETSİZ değeri (yoksa ilkini) seçeriz (örn. CONFIRMATION → DELIVERY_CONFIRMATION).
 * liability_amount gibi number/opsiyonel alanlara dokunmayız (sigorta eklenmez).
 */
function deriveBookOptions(q: { shipping_service_options?: unknown[] }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of q.shipping_service_options ?? []) {
    const o = raw as { key?: string; type?: string; values?: Array<{ value?: string; price?: number | string }> };
    if (typeof o.key !== 'string' || !o.key.startsWith('value_added_service__')) continue;
    if (o.type !== 'select' || !Array.isArray(o.values) || !o.values.length) continue;
    const free = o.values.find((v) => Number(v.price) === 0) ?? o.values[0];
    if (free?.value) out[o.key] = free.value;
  }
  return out;
}

/** Operatörün modalda seçebilmesi için bir quote'un ek servislerini sadeleştirip döner. */
function exposeServiceOptions(q: { shipping_service_options?: unknown[] }): Array<{ key: string; label?: string; type?: string; values?: Array<{ value: string; label?: string; price?: number | string }> }> {
  return (q.shipping_service_options ?? []).map((raw) => {
    const o = raw as { key: string; label?: string; type?: string; values?: Array<{ value: string; label?: string; price?: number | string }> };
    return {
      key: o.key, label: o.label, type: o.type,
      values: Array.isArray(o.values) ? o.values.map((v) => ({ value: v.value, label: v.label, price: v.price })) : undefined,
    };
  }).filter((o) => typeof o.key === 'string');
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

/** Amazon-dışı (standalone) için ManuMaestro'nun gönderdiği alıcı adresi. */
const addressSchema = z.object({
  name: z.string().min(1),
  company: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  line1: z.string().min(1),
  line2: z.string().optional(),
  town: z.string().min(1),
  county: z.string().optional(),
  postcode: z.string().min(1),
  country_code: z.string().min(2).max(2).default('US'),
});

const ratesSchema = z.object({
  /** Amazon yolu: Veeqo'da sipariş no ile aranır (deliver_to + line_items oradan). */
  amazonOrderNumber: z.string().min(3).optional(),
  /** Standalone (Amazon-dışı) yol: adres ManuMaestro'dan gelir, Veeqo'da sipariş aranmaz. */
  toAddress: addressSchema.optional(),
  /** Standalone customer_reference (genelde sipariş no). */
  reference: z.string().max(60).optional(),
  parcel: parcelSchema,
  contents: z.string().max(120).optional(),
  /** 'NJ' → Somerset, 'SHOWROOM' → Fairfield ship-from */
  warehouse: z.string().optional(),
  /** false → düz domestic quote (Amazon push YOK); default true (Buy Shipping + auto-push) */
  isAmazonOrder: z.boolean().default(true),
}).refine((d) => Boolean(d.amazonOrderNumber || d.toAddress), {
  message: 'amazonOrderNumber veya toAddress gerekli',
});

router.post('/rates', validateBody(ratesSchema), async (req: Request, res: Response) => {
  const { amazonOrderNumber, toAddress, reference, parcel, contents, warehouse, isAmazonOrder } = req.body as {
    amazonOrderNumber?: string; toAddress?: VeeqoAddress; reference?: string; parcel: VeeqoParcel; contents?: string; warehouse?: string; isAmazonOrder: boolean;
  };
  try {
    // İki kaynak: (a) standalone → adres body'den, Veeqo lookup YOK, is_amazon_order:false
    //            (b) Amazon → Veeqo'da sipariş no ile bul (deliver_to + channel_items)
    let to_address: VeeqoAddress;
    let channelItems: unknown[] = [];
    let customerRef: string;
    let destState: string | null = null;

    if (toAddress) {
      to_address = { ...toAddress, phone: cleanPhone(toAddress.phone) };
      customerRef = reference || 'standalone';
      destState = toAddress.county ?? null;
    } else {
      const order = await getOrderByNumber(amazonOrderNumber as string);
      if (!order) {
        return res.status(404).json({ success: false, error: `Veeqo'da sipariş bulunamadı: ${amazonOrderNumber}` });
      }
      to_address = toAddressFromOrder(order);
      channelItems = channelItemsFromOrder(order);
      customerRef = amazonOrderNumber as string;
      destState = ((order.deliver_to as { state?: string } | undefined)?.state) ?? null;
    }

    const result = await getRates({
      to_address,
      from_address: getShipFrom(warehouse),
      parcels: [parcel],
      customer_reference: customerRef,
      contents: contents || 'Metal Wall Art',
      // Amazon push (Buy Shipping) yalnız Amazon yolunda + channel_items varsa; standalone'da KAPALI
      ...(!toAddress && isAmazonOrder && channelItems.length ? { is_amazon_order: true, channel_items: channelItems } : {}),
    });
    // UI'a sade quote listesi (ucuzdan pahalıya) + her quote için booking'de
    // gönderilmesi gereken value-added-service'leri (zorunlu confirmation vb.) önceden çöz.
    const quotes = (result.quotes || [])
      .map((q) => ({
        rate_id: q.rate_id,
        service_name: q.service_name,
        service_carrier: q.service_carrier,
        total_charge: q.total_charge,
        delivery_estimate: q.delivery_estimate,
        options: deriveBookOptions(q),
        serviceOptions: exposeServiceOptions(q),
      }))
      .sort((a, b) => parseFloat(a.total_charge) - parseFloat(b.total_charge));
    await auditLog('veeqo-routing-rates', 'success', quotes.length);
    res.json({
      success: true,
      remoteShipmentId: result.remote_shipment_id,
      requestToken: result.request_token,
      expiresAt: result.expires_at,
      quotes,
      destState, // kıyas için (FedEx Izmir eyalet bazlı) — standalone'da toAddress.county, Amazon'da order.deliver_to.state
    });
  } catch (err: unknown) {
    await auditLog('veeqo-routing-rates', 'failed', 0, errMessage(err));
    logger.error('[VeeqoRouting] rates error:', errMessage(err));
    res.status(502).json({ success: false, error: errMessage(err) });
  }
});

// ---- POST /book (GERÇEK PARA) ----
const bookSchema = z.object({
  remoteShipmentId: z.string().min(3),
  rateId: z.string().min(3),
  requestToken: z.string().optional(),
  labelFormat: z.enum(['PDF', 'PNG', 'ZPL', 'JPEG']).default('PDF'),
  /** rates'ten gelen value-added-service değerleri (zorunlu confirmation vb.) */
  options: z.record(z.string(), z.string()).optional(),
  /** Audit için sipariş no (ManuMaestro'dan) — sync_log.detail'e yazılır. */
  orderNumber: z.string().max(100).optional(),
});

router.post('/book', validateBody(bookSchema), async (req: Request, res: Response) => {
  const { remoteShipmentId, rateId, requestToken, labelFormat, options, orderNumber } = req.body as {
    remoteShipmentId: string; rateId: string; requestToken?: string; labelFormat: 'PDF' | 'PNG' | 'ZPL' | 'JPEG'; options?: Record<string, string>; orderNumber?: string;
  };
  try {
    const result = await bookShipment({ remoteShipmentId, rateId, requestToken, labelFormat, options });
    const ok = result.successful?.[remoteShipmentId];
    if (!ok) {
      const fail = result.failed?.[remoteShipmentId];
      const msg = fail?.error_messages?.join('; ') || 'Veeqo booking başarısız (successful boş)';
      const friendly = overFulfillMessage(msg);
      await auditLog('veeqo-routing-book', 'failed', 0, msg);
      return res.status(502).json({ success: false, error: friendly ?? msg, ...(friendly ? { code: 'VEEQO_STUCK_SHIPMENT', raw: msg } : {}) });
    }
    const shipmentId = (ok as any).id || (ok as any).shipment_id || remoteShipmentId;
    // label: book response'unda base64 gelmezse get-label ile çek (retry'lı).
    // KRİTİK: book BAŞARILI (para çekildi) → etiket alınamasa bile route PATLAMASIN; aksi halde
    // çağıran hiçbir şey kaydetmez → sipariş DRAFT kalır → tekrar book = ÇİFT ÜCRET. Etiketsiz de
    // tracking+bedel döndür; üst kat (ManuMaestro) kaydı açıp tekrar-book'u engeller.
    let labelBase64: string | null = ok.label ?? null;
    let labelError: string | null = null;
    if (!labelBase64) {
      const fmt = labelFormat.toLowerCase() as 'pdf' | 'png' | 'zpl' | 'jpeg';
      try {
        labelBase64 = (await getLabel(String(shipmentId), fmt)).toString('base64');
      } catch (err: unknown) {
        labelError = errMessage(err);
        logger.warn(`[VeeqoRouting] book OK ama etiket alınamadı (shipment ${shipmentId}, tracking ${ok.tracking_number}): ${labelError}`);
      }
    }
    await auditLog('veeqo-routing-book', 'success', 1, undefined, `order=${orderNumber ?? '-'} ship=${shipmentId} trk=${ok.tracking_number ?? '-'}${labelBase64 ? '' : ' NOPDF'}`);
    logger.info(`[VeeqoRouting] book OK: order=${orderNumber ?? '-'} tracking=${ok.tracking_number} service=${ok.service_name}${labelBase64 ? '' : ' (PDF YOK)'}`);
    res.json({
      success: true,
      shipmentId: String(shipmentId),
      trackingNumber: ok.tracking_number,
      serviceName: ok.service_name,
      serviceCarrier: ok.service_carrier,
      totalCharge: ok.total_charge,
      labelBase64,
      labelFormat,
      ...(labelError ? { labelError } : {}),
    });
  } catch (err: unknown) {
    const raw = errMessage(err);
    const friendly = overFulfillMessage(raw);
    await auditLog('veeqo-routing-book', 'failed', 0, raw);
    logger.error('[VeeqoRouting] book error:', raw);
    res.status(502).json({ success: false, error: friendly ?? raw, ...(friendly ? { code: 'VEEQO_STUCK_SHIPMENT', raw } : {}) });
  }
});

// ---- POST /cancel ----
const cancelSchema = z.object({ shipmentId: z.string().min(3), orderNumber: z.string().max(100).optional() });

router.post('/cancel', validateBody(cancelSchema), async (req: Request, res: Response) => {
  const { shipmentId, orderNumber } = req.body as { shipmentId: string; orderNumber?: string };
  try {
    await cancelShipment(shipmentId);
    await auditLog('veeqo-routing-cancel', 'success', 1, undefined, `order=${orderNumber ?? '-'} ship=${shipmentId}`);
    logger.info(`[VeeqoRouting] cancel OK: order=${orderNumber ?? '-'} ship=${shipmentId}`);
    res.json({ success: true });
  } catch (err: unknown) {
    await auditLog('veeqo-routing-cancel', 'failed', 0, errMessage(err), `order=${orderNumber ?? '-'} ship=${shipmentId}`);
    logger.error('[VeeqoRouting] cancel error:', errMessage(err));
    res.status(502).json({ success: false, error: errMessage(err) });
  }
});

export default router;

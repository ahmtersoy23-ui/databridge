import { downloadShipmentsExcel } from '../wisersell/webClient';
import { importShipmentsFromBuffer, ImportSummary } from './omsShipmentImport';
import logger from '../../config/logger';

/**
 * Wisersell shipment sync — günlük cron.
 *
 * Akış:
 *   1. Web app'e login (cached JWT, 4h)
 *   2. /api/excel/shipment çağır (status:[1] = Gönderilmiş)
 *   3. Excel buffer'ı parse et
 *   4. oms_shipments'a UPSERT
 *
 * Mevcut tracking'ler otomatik güncellenir (idempotent UPSERT).
 * Yeni tracking'ler eklenir + fedex_synced_at NULL → 23:00 UTC FedEx Track sync onları çekecek.
 */

export async function syncWisersellShipments(): Promise<ImportSummary> {
  logger.info('[WisersellShipmentSync] Excel indiriliyor...');
  const buffer = await downloadShipmentsExcel({ status: [1] });
  logger.info(`[WisersellShipmentSync] Excel indirildi (${(buffer.length / 1024).toFixed(0)} KB)`);

  const sourceFile = `wisersell-cron-${new Date().toISOString().slice(0, 10)}.xlsx`;
  // Cron mode: sadece yeni tracking'leri ekle (mevcut kayıtlar dokunulmaz)
  const summary = await importShipmentsFromBuffer(buffer, sourceFile, 'insert_only');

  logger.info(
    `[WisersellShipmentSync] Bitti: ${summary.inserted} yeni eklendi, ` +
    `${summary.alreadyExists} mevcut atlandı (toplam ${summary.totalRows} satır)`,
  );

  // FEDEX IWA payına bak — DataBridge cron'unun beslediği asıl carrier
  const fedexCount = summary.carrierCounts['FEDEX IWA'] || 0;
  if (fedexCount > 0) {
    logger.info(`[WisersellShipmentSync] FEDEX IWA: ${fedexCount} tracking`);
  }

  return summary;
}

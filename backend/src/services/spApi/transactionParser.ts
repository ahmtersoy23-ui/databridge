/**
 * Transaction enrichment functions — ported from AmzSellMetrics frontend
 * for AmzSellMetrics-compatible data storage.
 */

// Marketplace timezone offsets (matches AmzSellMetrics backend)
const MARKETPLACE_TIMEZONES: Record<string, number> = {
  US: -8, CA: -8, MX: -6,
  UK: 0, DE: 1, FR: 1, IT: 1, ES: 1, NL: 1, PL: 1, SE: 1,
  AU: 10, AE: 4, SA: 3,
  SG: 8, TR: 3, BR: -3, JP: 9, IN: 5.5,
};

/**
 * Detect fulfillment type from fulfillment field value.
 * Ported from AmzSellMetrics helpers.ts:43-69
 */
export function detectFulfillment(value: unknown): string {
  if (!value) return 'Unknown';
  const str = String(value).toLowerCase().trim();

  // FBM detection (multi-language)
  if (str.includes('seller') ||
      str.includes('merchant') ||
      str.includes('mfn') ||
      str.includes('verkäufer') ||
      str.includes('vendeur') ||
      str.includes('venditore') ||
      str.includes('vendedor') ||
      str.includes('satıcı') ||
      str.includes('satici') ||
      str.includes('بائع')) {
    return 'FBM';
  }

  // FBA detection
  if (str.includes('afn')) return 'FBA';
  if (str.includes('amazon') && !str.includes('amazon.')) return 'FBA';
  if (str === 'amazon' || str.startsWith('amazon ') || str.endsWith(' amazon') || str.includes(' amazon ')) return 'FBA';

  return 'Unknown';
}

/**
 * Categorize transaction type (multi-language).
 * Ported from AmzSellMetrics helpers.ts:75-177
 */
export function categorizeTransactionType(type: unknown): string | null {
  if (!type) return null;
  const typeStr = String(type).toLowerCase().trim();

  // Transfer/Disbursement
  if ((typeStr.includes('transfer') ||
       typeStr.includes('übertrag') ||
       typeStr.includes('transfert') ||
       typeStr.includes('trasferimento') ||
       typeStr.includes('transferir')) &&
      !typeStr.includes('retrocharge')) {
    return 'Disbursement';
  }

  // Order
  if ((typeStr.includes('order') ||
       typeStr.includes('bestellung') ||
       typeStr.includes('commande') ||
       typeStr.includes('ordine') ||
       typeStr.includes('pedido')) &&
      !typeStr.includes('removal')) {
    return 'Order';
  }

  // Refund
  if ((typeStr.includes('refund') ||
       typeStr.includes('erstattung') ||
       typeStr.includes('remboursement') ||
       typeStr.includes('rimborso') ||
       typeStr.includes('reembolso')) &&
      !typeStr.includes('chargeback')) {
    return 'Refund';
  }

  // Adjustment
  if (typeStr.includes('adjustment') ||
      typeStr.includes('anpassung') ||
      typeStr.includes('ajustement') ||
      typeStr.includes('modifica') ||
      typeStr.includes('rettifica')) {
    return 'Adjustment';
  }

  // Amazon Fees
  if (typeStr.includes('amazon fees')) return 'Amazon Fees';

  // Chargeback Refund
  if (typeStr.includes('chargeback')) return 'Chargeback Refund';

  // FBA Inventory Fee (multi-language)
  if (typeStr.includes('fba inventory fee') ||
      typeStr.includes('fulfilment by amazon inventory fee') ||
      typeStr.includes('versand durch amazon lagergebühr') ||
      typeStr.includes('frais de stock expédié par amazon') ||
      typeStr.includes('costo di stoccaggio logistica di amazon') ||
      typeStr.includes('tarifas de inventario de logística de amazon')) {
    return 'FBA Inventory Fee';
  }

  // FBA Customer Return Fee
  if (typeStr.includes('fba customer return fee')) return 'FBA Customer Return Fee';

  // FBA Transaction Fee
  if (typeStr.includes('fba transaction fee')) return 'FBA Transaction Fee';

  // Fee Adjustment
  if (typeStr.includes('fee adjustment')) return 'Fee Adjustment';

  // SAFE-T Reimbursement
  if (typeStr.includes('safe-t') || typeStr.includes('safet')) return 'SAFE-T Reimbursement';

  // Shipping Services
  if (typeStr.includes('shipping services')) return 'Shipping Services';

  // Delivery Services
  if (typeStr.includes('delivery services') || typeStr.includes('lieferdienste')) {
    return 'Delivery Services';
  }

  // Liquidations (multi-language)
  if (typeStr.includes('liquidations') ||
      typeStr.includes('liquidationen') ||
      typeStr.includes('liquidationsanpassungen')) {
    return 'Liquidations';
  }

  // Commingling VAT
  if (typeStr.includes('commingling vat')) return 'Commingling VAT';

  // Service Fee (multi-language)
  if (typeStr.includes('service fee') ||
      typeStr.includes('servicegebühr') ||
      typeStr.includes('frais de service') ||
      typeStr.includes('commissione di servizio') ||
      typeStr.includes('tarifa de prestación de servicio')) {
    return 'Service Fee';
  }

  // Others
  if (typeStr.includes('others')) return 'Others';

  return 'Other';
}

/**
 * Detect marketplace code from marketplace URL/name.
 * Ported from AmzSellMetrics helpers.ts:381-398
 */
export function detectMarketplaceCode(marketplace: unknown): string {
  if (!marketplace) return '';
  const str = String(marketplace).toLowerCase().trim();

  // Order matters — longer/specific matches first so amazon.com.be doesn't
  // fall through to the generic amazon.com → US branch.
  if (str.includes('amazon.com.au')) return 'AU';
  if (str.includes('amazon.com.be')) return 'BE';
  if (str.includes('amazon.com.tr')) return 'TR';
  if (str.includes('amazon.com.mx')) return 'MX';
  if (str.includes('amazon.co.uk')) return 'UK';
  if (str.includes('amazon.de')) return 'DE';
  if (str.includes('amazon.fr')) return 'FR';
  if (str.includes('amazon.it')) return 'IT';
  if (str.includes('amazon.es')) return 'ES';
  if (str.includes('amazon.nl')) return 'NL';
  if (str.includes('amazon.se')) return 'SE';
  if (str.includes('amazon.pl')) return 'PL';
  if (str.includes('amazon.ca')) return 'CA';
  if (str.includes('amazon.ae')) return 'AE';
  if (str.includes('amazon.sa')) return 'SA';
  if (str.includes('amazon.com') || str.includes('www.amazon.com')) return 'US';

  return '';
}

/**
 * Parse number from various formats (EN/EU).
 * Ported from AmzSellMetrics helpers.ts:182-205
 */
export function parseNumber(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;

  let str = String(value).trim();

  const dotCount = (str.match(/\./g) || []).length;
  const commaCount = (str.match(/,/g) || []).length;

  const lastDotIndex = str.lastIndexOf('.');
  const lastCommaIndex = str.lastIndexOf(',');

  if (commaCount > 0 && (dotCount === 0 || lastCommaIndex > lastDotIndex)) {
    // European format: comma is decimal separator
    str = str.replace(/[\s.]/g, '').replace(',', '.');
  } else {
    // English/US format: dot is decimal separator
    str = str.replace(/[\s,]/g, '');
  }

  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

/**
 * Generate transaction_id matching AmzSellMetrics format.
 * Ported from AmzSellMetrics fileProcessor.ts:276-283
 */
export function generateTransactionId(
  marketplaceCode: string,
  date: Date,
  type: string,
  orderId: string,
  sku: string,
  total: number
): string {
  return [
    marketplaceCode,
    date.toISOString().replace('T', '_').replace(/:/g, '-').replace(/\./g, '-').replace('Z', ''),
    String(type || '').replace(/\s+/g, '_').slice(0, 20),
    String(orderId || 'X'),
    String(sku || 'X'),
    String(total || '0'),
  ].join('_').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 255);
}

/**
 * Compute marketplace-local date from UTC timestamp.
 * Ported from AmzSellMetrics amazonAnalyzer.ts:500-503
 */
export function computeDateOnly(utcDate: Date, marketplaceCode: string): string {
  const offset = MARKETPLACE_TIMEZONES[marketplaceCode] || 0;
  const localDate = new Date(utcDate.getTime() + offset * 60 * 60 * 1000);
  return localDate.toISOString().split('T')[0];
}

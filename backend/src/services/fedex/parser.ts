import type { FedexTrackResult } from './client';

/**
 * FedEx Track API yanıtını fedex_shipments tablosuna upsert edilebilir
 * normalize edilmiş bir satıra çevirir.
 */
export interface ParsedShipment {
  tracking_number: string;
  service_type: string | null;
  service_description: string | null;
  ship_timestamp: string | null;
  delivered_timestamp: string | null;
  estimated_delivery: string | null;
  origin_country: string | null;
  origin_city: string | null;
  origin_postal: string | null;
  dest_country: string | null;
  dest_state: string | null;
  dest_city: string | null;
  dest_postal: string | null;
  weight_kg: number | null;
  /** Paket ebatları cm (FedEx packageDetails.weightAndDimensions.dimensions, units=CM). */
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  /** Dimensional weight = L×W×H/5000. FedEx fatura chargeable = max(weight_kg, dim_weight_kg). */
  dim_weight_kg: number | null;
  package_count: number | null;
  latest_status_code: string | null;
  latest_status_desc: string | null;
  scan_events: unknown;
  raw_response: unknown;
  not_found: boolean;
  shipper_reference: string | null;
}

function extractShipperReference(tr: any): string | null {
  // additionalTrackingInfo.packageIdentifiers[].SHIPPER_REFERENCE.values
  // Bizim TR ihracat akışı için "ETGB" değeri geliyor — ETGB var/yok gönderinin
  // bizim FedEx anlaşmamız üzerinden çıkıp çıkmadığını ayırt eden imza.
  const ids = tr?.additionalTrackingInfo?.packageIdentifiers;
  if (!Array.isArray(ids)) return null;
  const ref = ids.find((p: any) => p?.type === 'SHIPPER_REFERENCE');
  if (!ref || !Array.isArray(ref.values) || ref.values.length === 0) return null;
  return String(ref.values[0]).trim() || null;
}

function findDateTime(arr: any[] | undefined, type: string): string | null {
  if (!Array.isArray(arr)) return null;
  const match = arr.find(d => d?.type === type);
  return match?.dateTime || null;
}

function getAddress(loc: any): any {
  // FedEx sometimes nests address under locationContactAndAddress, sometimes not.
  return loc?.locationContactAndAddress?.address || loc?.address || loc || {};
}

function getWeightKg(weights: any[] | undefined): number | null {
  if (!Array.isArray(weights) || weights.length === 0) return null;
  // KG kaydını tercih et, yoksa LB'i çevir
  const kgRow = weights.find(w => typeof w?.unit === 'string' && w.unit.toUpperCase() === 'KG');
  const w = kgRow ?? weights[0];
  if (w?.value == null) return null;
  const num = Number(w.value);
  if (!isFinite(num)) return null;
  if (typeof w.unit === 'string' && w.unit.toUpperCase() === 'LB') {
    return Number((num * 0.453592).toFixed(2));
  }
  return Number(num.toFixed(2));
}

interface Dims {
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  dim_weight_kg: number | null;
}

function getDimensionsCm(dims: any[] | undefined): Dims {
  const empty: Dims = { length_cm: null, width_cm: null, height_cm: null, dim_weight_kg: null };
  if (!Array.isArray(dims) || dims.length === 0) return empty;
  const cm = dims.find(d => typeof d?.units === 'string' && d.units.toUpperCase() === 'CM');
  const inRow = dims.find(d => typeof d?.units === 'string' && d.units.toUpperCase() === 'IN');
  const source = cm ?? inRow;
  if (!source) return empty;
  const toCm = (v: unknown) => {
    const n = Number(v);
    if (!isFinite(n)) return null;
    if (source === inRow) return Number((n * 2.54).toFixed(1));
    return Number(n.toFixed(1));
  };
  const L = toCm(source.length);
  const W = toCm(source.width);
  const H = toCm(source.height);
  const dim_weight_kg =
    L != null && W != null && H != null && L > 0 && W > 0 && H > 0
      ? Number(((L * W * H) / 5000).toFixed(2))
      : null;
  return { length_cm: L, width_cm: W, height_cm: H, dim_weight_kg };
}

const NOT_FOUND_TEMPLATE: Omit<ParsedShipment, 'tracking_number' | 'raw_response' | 'not_found' | 'shipper_reference'> = {
  service_type: null,
  service_description: null,
  ship_timestamp: null,
  delivered_timestamp: null,
  estimated_delivery: null,
  origin_country: null,
  origin_city: null,
  origin_postal: null,
  dest_country: null,
  dest_state: null,
  dest_city: null,
  dest_postal: null,
  weight_kg: null,
  length_cm: null,
  width_cm: null,
  height_cm: null,
  dim_weight_kg: null,
  package_count: null,
  latest_status_code: null,
  latest_status_desc: null,
  scan_events: null,
};

export function parseTrackResult(result: FedexTrackResult): ParsedShipment {
  if (result.notFound || !result.raw) {
    return {
      tracking_number: result.trackingNumber,
      ...NOT_FOUND_TEMPLATE,
      raw_response: result.raw ?? {
        error: { code: result.errorCode, message: result.errorMessage },
      },
      not_found: true,
      shipper_reference: null,
    };
  }

  const tr = result.raw;
  const dates = tr.dateAndTimes || [];

  const shipDateTime =
    findDateTime(dates, 'ACTUAL_PICKUP') ||
    findDateTime(dates, 'SHIP') ||
    findDateTime(dates, 'ACTUAL_TENDER');
  const deliveredDateTime = findDateTime(dates, 'ACTUAL_DELIVERY');
  const estimatedDateTime =
    findDateTime(dates, 'ESTIMATED_DELIVERY') ||
    findDateTime(dates, 'COMMITMENT');

  const originAddr = getAddress(tr.originLocation || tr.shipperInformation);
  const destAddr = getAddress(tr.destinationLocation || tr.recipientInformation);

  const shipDetails = tr.shipmentDetails || {};
  const packageDetails = tr.packageDetails || {};
  const wad = packageDetails.weightAndDimensions || {};

  const weight = getWeightKg(wad.weight || shipDetails.weight || packageDetails.weight);
  const dims = getDimensionsCm(wad.dimensions);
  const packageCount =
    shipDetails.packageCount != null
      ? Number(shipDetails.packageCount)
      : packageDetails.packageSequence?.totalPackages != null
        ? Number(packageDetails.packageSequence.totalPackages)
        : null;

  const status = tr.latestStatusDetail || {};

  return {
    tracking_number: result.trackingNumber,
    service_type: tr.serviceDetail?.type || null,
    service_description: tr.serviceDetail?.description || null,
    ship_timestamp: shipDateTime,
    delivered_timestamp: deliveredDateTime,
    estimated_delivery: estimatedDateTime,
    origin_country: originAddr.countryCode || null,
    origin_city: originAddr.city || null,
    origin_postal: originAddr.postalCode || null,
    dest_country: destAddr.countryCode || null,
    dest_state: destAddr.stateOrProvinceCode || null,
    dest_city: destAddr.city || null,
    dest_postal: destAddr.postalCode || null,
    weight_kg: weight,
    length_cm: dims.length_cm,
    width_cm: dims.width_cm,
    height_cm: dims.height_cm,
    dim_weight_kg: dims.dim_weight_kg,
    package_count: packageCount && isFinite(packageCount) ? packageCount : null,
    latest_status_code: status.code || null,
    latest_status_desc: status.description || status.derivedStatus || null,
    scan_events: tr.scanEvents || null,
    raw_response: tr,
    not_found: false,
    shipper_reference: extractShipperReference(tr),
  };
}

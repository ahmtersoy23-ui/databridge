import { describe, it, expect } from 'vitest';
import { parseTrackResult } from '../services/fedex/parser';

// FedEx Track API yanitini fedex_shipments satirina ceviren saf parser.
// Fatura mutabakati buna dayaniyor (chargeable = max(weight_kg, dim_weight_kg)),
// o yuzden agirlik/ebat/ETGB cikarimi dogru olmali.

const makeResult = (overrides: any = {}) => ({
  trackingNumber: '794123456789',
  notFound: false,
  raw: {},
  ...overrides,
});

describe('parseTrackResult — not found', () => {
  it('notFound=true → not_found satiri, hata raw_response icinde', () => {
    const p = parseTrackResult({
      trackingNumber: 'XXX',
      notFound: true,
      raw: null,
      errorCode: 'TRACKING.TRACKINGNUMBER.NOTFOUND',
      errorMessage: 'Not found',
    } as any);
    expect(p.not_found).toBe(true);
    expect(p.tracking_number).toBe('XXX');
    expect(p.latest_status_code).toBeNull();
    expect((p.raw_response as any).error.code).toBe('TRACKING.TRACKINGNUMBER.NOTFOUND');
  });

  it('raw yoksa → not_found', () => {
    const p = parseTrackResult(makeResult({ raw: null }));
    expect(p.not_found).toBe(true);
  });
});

describe('parseTrackResult — teslim edilmis gonderi', () => {
  const raw = {
    serviceDetail: { type: 'FEDEX_INTERNATIONAL_PRIORITY', description: 'Intl Priority' },
    latestStatusDetail: { code: 'DL', description: 'Delivered' },
    dateAndTimes: [
      { type: 'ACTUAL_PICKUP', dateTime: '2026-06-01T10:00:00' },
      { type: 'ACTUAL_DELIVERY', dateTime: '2026-06-04T14:30:00' },
      { type: 'ESTIMATED_DELIVERY', dateTime: '2026-06-03T12:00:00' },
    ],
    originLocation: { address: { countryCode: 'TR', city: 'Izmir', postalCode: '35000' } },
    destinationLocation: {
      address: { countryCode: 'US', stateOrProvinceCode: 'NJ', city: 'Somerset', postalCode: '08873' },
    },
    packageDetails: {
      weightAndDimensions: {
        weight: [{ unit: 'KG', value: '12.5' }],
        dimensions: [{ units: 'CM', length: 50, width: 40, height: 30 }],
      },
    },
    shipmentDetails: { packageCount: 2 },
    additionalTrackingInfo: {
      packageIdentifiers: [{ type: 'SHIPPER_REFERENCE', values: ['ETGB'] }],
    },
  };

  it('temel alanlar dogru cikar', () => {
    const p = parseTrackResult(makeResult({ raw }));
    expect(p.not_found).toBe(false);
    expect(p.latest_status_code).toBe('DL');
    expect(p.service_type).toBe('FEDEX_INTERNATIONAL_PRIORITY');
    expect(p.delivered_timestamp).toBe('2026-06-04T14:30:00');
    expect(p.estimated_delivery).toBe('2026-06-03T12:00:00');
    expect(p.origin_country).toBe('TR');
    expect(p.dest_country).toBe('US');
    expect(p.dest_state).toBe('NJ');
    expect(p.package_count).toBe(2);
  });

  it('agirlik KG ve dim weight = L×W×H/5000', () => {
    const p = parseTrackResult(makeResult({ raw }));
    expect(p.weight_kg).toBe(12.5);
    expect(p.length_cm).toBe(50);
    // 50*40*30/5000 = 12
    expect(p.dim_weight_kg).toBe(12);
  });

  it('ETGB shipper reference cikarilir (TR ihracat imzasi)', () => {
    const p = parseTrackResult(makeResult({ raw }));
    expect(p.shipper_reference).toBe('ETGB');
  });
});

describe('parseTrackResult — birim donusumleri', () => {
  it('LB agirlik KG\'a cevrilir', () => {
    const p = parseTrackResult(makeResult({
      raw: { packageDetails: { weightAndDimensions: { weight: [{ unit: 'LB', value: '10' }] } } },
    }));
    // 10 * 0.453592 ≈ 4.54
    expect(p.weight_kg).toBe(4.54);
  });

  it('IN ebatlar CM\'e cevrilir', () => {
    const p = parseTrackResult(makeResult({
      raw: { packageDetails: { weightAndDimensions: { dimensions: [{ units: 'IN', length: 10, width: 10, height: 10 }] } } },
    }));
    // 10 in = 25.4 cm
    expect(p.length_cm).toBe(25.4);
  });

  it('shipper reference yoksa null', () => {
    const p = parseTrackResult(makeResult({ raw: { latestStatusDetail: { code: 'IT' } } }));
    expect(p.shipper_reference).toBeNull();
  });
});

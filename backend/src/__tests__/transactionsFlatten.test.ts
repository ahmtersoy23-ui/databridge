import { describe, it, expect } from 'vitest';
import {
  getChargeAmount,
  getFeeAmount,
  sumFees,
  sumCharges,
  sumPromotions,
  sumTaxWithheld,
  flattenShipmentEvent,
  flattenFinancialEvents,
} from '../services/spApi/transactions';

// SP-API Finances event'lerini FinancialTransaction satirlarina ceviren saf
// para matematigi. Cron-canli (transactionSync → financial_transactions) ama
// onceden SIFIR testi vardi. Bir alan adi typo'su sessizce parayi eksiltir.

describe('amount helper\'lari — alan adi + eksik alan davranisi', () => {
  it('getChargeAmount tipe gore bulur, yoksa 0', () => {
    const charges = [
      { ChargeType: 'Principal', ChargeAmount: { CurrencyAmount: 25.5 } },
      { ChargeType: 'Tax', ChargeAmount: { CurrencyAmount: 4.5 } },
    ];
    expect(getChargeAmount(charges, 'Principal')).toBe(25.5);
    expect(getChargeAmount(charges, 'Tax')).toBe(4.5);
    expect(getChargeAmount(charges, 'ShippingCharge')).toBe(0); // yok → 0
    expect(getChargeAmount(undefined, 'Principal')).toBe(0);
    expect(getChargeAmount([{ ChargeType: 'Principal' }], 'Principal')).toBe(0); // ChargeAmount yok
  });

  it('getFeeAmount FeeType\'a gore', () => {
    const fees = [
      { FeeType: 'Commission', FeeAmount: { CurrencyAmount: -3.0 } },
      { FeeType: 'FBAPerUnitFulfillmentFee', FeeAmount: { CurrencyAmount: -2.5 } },
    ];
    expect(getFeeAmount(fees, 'Commission')).toBe(-3.0);
    expect(getFeeAmount(fees, 'FBAPerUnitFulfillmentFee')).toBe(-2.5);
    expect(getFeeAmount(fees, 'Nonexistent')).toBe(0);
  });

  it('sumFees exclude listesi disindakileri toplar', () => {
    const fees = [
      { FeeType: 'Commission', FeeAmount: { CurrencyAmount: -3 } },
      { FeeType: 'FBAPerUnitFulfillmentFee', FeeAmount: { CurrencyAmount: -2 } },
      { FeeType: 'RefundCommission', FeeAmount: { CurrencyAmount: -1 } },
    ];
    // Commission + FBA haric → sadece RefundCommission
    expect(sumFees(fees, ['Commission', 'FBAPerUnitFulfillmentFee'])).toBe(-1);
    expect(sumFees(fees)).toBe(-6); // hepsi
    expect(sumFees(undefined)).toBe(0);
  });

  it('sumCharges / sumPromotions toplar', () => {
    expect(sumCharges([
      { ChargeAmount: { CurrencyAmount: 10 } },
      { ChargeAmount: { CurrencyAmount: 5 } },
    ])).toBe(15);
    expect(sumPromotions([
      { PromotionAmount: { CurrencyAmount: -2 } },
      { PromotionAmount: { CurrencyAmount: -1 } },
    ])).toBe(-3);
  });

  it('sumTaxWithheld nested TaxesWithheld dizisini toplar', () => {
    const list = [
      { TaxesWithheld: [{ ChargeAmount: { CurrencyAmount: 1.2 } }, { ChargeAmount: { CurrencyAmount: 0.8 } }] },
      { TaxesWithheld: [{ ChargeAmount: { CurrencyAmount: 2.0 } }] },
    ];
    expect(sumTaxWithheld(list)).toBe(4.0);
    expect(sumTaxWithheld(undefined)).toBe(0);
    expect(sumTaxWithheld([{}])).toBe(0); // TaxesWithheld yok
  });
});

describe('flattenShipmentEvent — siparis (Order)', () => {
  const orderEvent = {
    PostedDate: '2026-06-01T12:00:00Z',
    AmazonOrderId: '111-2222222-3333333',
    MarketplaceName: 'Amazon.com',
    ShipmentItemList: [
      {
        SellerSKU: 'AHM001',
        QuantityShipped: 2,
        ItemChargeList: [
          { ChargeType: 'Principal', ChargeAmount: { CurrencyAmount: 40 } },
          { ChargeType: 'Tax', ChargeAmount: { CurrencyAmount: 4 } },
          { ChargeType: 'ShippingCharge', ChargeAmount: { CurrencyAmount: 5 } },
        ],
        ItemFeeList: [
          { FeeType: 'Commission', FeeAmount: { CurrencyAmount: -6 } },
          { FeeType: 'FBAPerUnitFulfillmentFee', FeeAmount: { CurrencyAmount: -3 } },
        ],
        PromotionList: [{ PromotionAmount: { CurrencyAmount: -2 } }],
      },
    ],
  };

  it('tek item → tek satir, alanlar dogru', () => {
    const txns = flattenShipmentEvent(orderEvent, 'Order', 1);
    expect(txns).toHaveLength(1);
    const t = txns[0];
    expect(t.sku).toBe('AHM001');
    expect(t.quantity).toBe(2);
    expect(t.product_sales).toBe(40);
    expect(t.selling_fees).toBe(-6);   // Commission
    expect(t.fba_fees).toBe(-3);       // FBAPerUnit
    expect(t.promotional_rebates).toBe(-2);
    expect(t.fulfillment).toBe('FBA'); // fbaFees != 0
    expect(t.credential_id).toBe(1);
  });

  it('total = principal+tax+shipping + fees + promo', () => {
    const t = flattenShipmentEvent(orderEvent, 'Order', 1)[0];
    // 40 + 4(tax) + 5(ship) + 0(shipTax) + (-6 selling) + (-3 fba) + 0(other) + (-2 promo) = 38
    expect(t.total).toBe(38);
    expect(t.other).toBe(5); // shippingCharge + shippingTax
  });

  it('FBA fee yoksa fulfillment = FBM', () => {
    const fbmEvent = {
      ...orderEvent,
      ShipmentItemList: [{
        SellerSKU: 'AHM002', QuantityShipped: 1,
        ItemChargeList: [{ ChargeType: 'Principal', ChargeAmount: { CurrencyAmount: 20 } }],
        ItemFeeList: [{ FeeType: 'Commission', FeeAmount: { CurrencyAmount: -3 } }],
      }],
    };
    expect(flattenShipmentEvent(fbmEvent, 'Order', 1)[0].fulfillment).toBe('FBM');
  });

  it('gecersiz PostedDate → bos dizi', () => {
    expect(flattenShipmentEvent({ ...orderEvent, PostedDate: 'garbage' }, 'Order', 1)).toHaveLength(0);
    expect(flattenShipmentEvent({ ...orderEvent, PostedDate: null }, 'Order', 1)).toHaveLength(0);
  });
});

describe('flattenShipmentEvent — iade (Refund, *AdjustmentList)', () => {
  it('ShipmentItemAdjustmentList + ItemChargeAdjustmentList yolu', () => {
    const refundEvent = {
      PostedDate: '2026-06-02T10:00:00Z',
      AmazonOrderId: '111-9999999-8888888',
      MarketplaceName: 'Amazon.com',
      ShipmentItemAdjustmentList: [
        {
          SellerSKU: 'AHM001',
          QuantityShipped: 1,
          ItemChargeAdjustmentList: [{ ChargeType: 'Principal', ChargeAmount: { CurrencyAmount: -20 } }],
          ItemFeeAdjustmentList: [{ FeeType: 'RefundCommission', FeeAmount: { CurrencyAmount: 3 } }],
        },
      ],
    };
    const txns = flattenShipmentEvent(refundEvent, 'Refund', 1);
    expect(txns).toHaveLength(1);
    expect(txns[0].product_sales).toBe(-20);          // iade negatif
    expect(txns[0].other_transaction_fees).toBe(3);   // RefundCommission (other, excludes Commission/FBA)
  });
});

describe('flattenFinancialEvents — dispatch', () => {
  it('ShipmentEventList satirlari uretir', () => {
    const events = {
      ShipmentEventList: [{
        PostedDate: '2026-06-01T12:00:00Z',
        AmazonOrderId: 'A1',
        MarketplaceName: 'Amazon.com',
        ShipmentItemList: [{
          SellerSKU: 'X1', QuantityShipped: 1,
          ItemChargeList: [{ ChargeType: 'Principal', ChargeAmount: { CurrencyAmount: 10 } }],
        }],
      }],
    };
    const txns = flattenFinancialEvents(events, 1);
    expect(txns.length).toBeGreaterThanOrEqual(1);
    expect(txns.some(t => t.sku === 'X1' && t.product_sales === 10)).toBe(true);
  });

  it('bos/eksik event → bos dizi (crash etmez)', () => {
    expect(flattenFinancialEvents({}, 1)).toEqual([]);
  });
});

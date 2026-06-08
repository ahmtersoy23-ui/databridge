import { describe, it, expect, vi } from 'vitest';

// Route modülü import edilince pool/DB yan etkisi olmasın diye mock'la (saf fonksiyon test ediliyor).
vi.mock('../config/database', () => ({ pool: { query: vi.fn() } }));

import { overFulfillMessage } from '../routes/veeqoRouting';

describe('overFulfillMessage', () => {
  const RAW =
    'Veeqo book-shipment [HTTP 422]: InvalidRequestException, errorCode: SINGLE_PURCHASE_VALIDATION_RATE, errorMessage: Attempting to over-fulfill item(s).  Please check the item quantities and retry. Existing shipmentIds for order:[7d556ec4-f8e5-4c74-84ea-215cbce41320]';

  it('over-fulfill hatasını yakalar ve takılı shipment id ini mesaja koyar', () => {
    const msg = overFulfillMessage(RAW);
    expect(msg).not.toBeNull();
    expect(msg).toContain('7d556ec4-f8e5-4c74-84ea-215cbce41320');
    expect(msg).toContain('over-fulfill');
  });

  it('errorCode tek başına da yakalanır (shipment id yoksa parantezsiz)', () => {
    const msg = overFulfillMessage('errorCode: SINGLE_PURCHASE_VALIDATION_RATE, errorMessage: ...');
    expect(msg).not.toBeNull();
    expect(msg).not.toContain('var ('); // shipment id parantezi gelmemeli
  });

  it('alakasız hatada null döner (ham mesaj kullanılsın)', () => {
    expect(overFulfillMessage('Veeqo book-shipment [HTTP 500]: Internal Server Error')).toBeNull();
    expect(overFulfillMessage('Veeqo get-label [HTTP 404]: Not found')).toBeNull();
  });
});

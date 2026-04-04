# DataBridge

Marketplace veri hub'i. Amazon SP-API, Ads, Wayfair'den veri ceker, pricelab_db'ye yazar.
Diger app'ler (StockPulse, AmzSellMetrics, PriceLab) bu veriye bagimli.

## Komutlar
```bash
cd backend && npm run dev    # lokal gelistirme (port 3008)
cd backend && npm test       # vitest (13 test)
cd backend && npm run build  # tsc
```

## Kurallar
- Yeni cron job → `withSyncLog()` ile sar
- Yeni writer → %20 safety threshold uygula (bkz. salesDataWriter.ts)
- `sku NOT LIKE 'amzn.gr.%'` ve `item_price > 0` her sorguda
- sync_log tablosuna kayit dusur
- ads raporlarinda `cost` vs `spend` farki: targeting/advertised → `cost`, search_term → `spend`
- SP-API: credential basina tek cagri (region = tum ulkeler)
- Wayfair: `fromDate` pagination zorunlu, limit tek basina yetmez

## DB'ler
- `pool` → databridge_db (kendi)
- `sharedPool` → pricelab_db (sales_data, fba_inventory, amz_transactions YAZAR)

# DataBridge

Marketplace **veri merkezi**. Amazon (SP-API + Ads), Wayfair, Walmart, Bol, Takealot,
Kaufland, Wisersell, FedEx ve Veeqo'dan veri ceker, normalize eder ve diger app'lerin
kullanacagi formata donusturur. StockPulse, AmzSellMetrics, PriceLab ve ManuMaestro
bu veriye bagimlidir.

## Stack
Express TS + PostgreSQL (`pg`) + node-cron + Winston + Zod + Sentry. Test: Vitest.

## Veritabanlari
- **databridge_db** (kendi, `pool`): raw_orders, *_raw_orders, wayfair_*, ads_*, oms_shipments, credentials, sync_log
- **pricelab_db** (paylasimli, `sharedPool`, **YAZAR**): `sales_data`, `fba_inventory`, `channel_prices`

> `amz_transactions` artik SP-API'den yazilmaz — yalnizca Excel upload besler.

## Cron job'lar
Tum schedule'lar `backend/src/config/constants.ts`'te tanimli (tek dogru kaynak).
Kayitlar `backend/src/services/sync/scheduler.ts`'te. Gruplar:

- **SP-API**: inventory (stok), sales (siparis → sales_data), transactions (finans), aging, business-report, fee-rates
- **Amazon Ads**: SP / SB / SD raporlari, campaign-snapshot, brand-analytics
- **Marketplace siparisleri**: Walmart, Bol, Takealot, Kaufland → *_raw_orders + sales_data
- **Wisersell**: catalog, orders, pending, routing-poll (her 20dk), shipment
- **Lojistik/fiyat**: FedEx tracking (full + delta), channel-prices
- **Denetim**: sku-master-diff (haftalik), data-quality (gunluk Slack ozeti)

Review tracking sunucuda DEGIL — lokal Mac'te launchd ile calisir (`local-review-fetcher/`).

## Guvenlik mekanizmalari
Her job `withSyncLog` ile sarilir; fail veya satir-dususu Slack'e bildirilir.

- **Write safety**: sales_data/fba_inventory yazarken yeni veri eskinin %20'sinden azsa YAZILMAZ (veri kaybi onleme). Esik `getSafetyDropThreshold()`, default 0.2, env ile job-bazli ayarlanir.
- **sync_log**: Her job icin started_at, finished_at, status, rows_processed, error_message.
- **Row-drop anomali**: Onceki basarili calismaya gore esigin altinda dususte otomatik Slack alarmi.
- **Retry**: `withRetry` — 3 deneme, exponential backoff (5s → 20s → 45s), 429/5xx/network transient.
- **data-quality**: Gunluk health check — ads tablolari + sales_data + fba_inventory tazelik/0-satir/dupe denetimi, Slack ozeti.

## Onemli kurallar
- `sku NOT LIKE 'amzn.gr.%'` — iade SKU'lari Amazon sorgularinda filtrelenir
- `item_price > 0` — bedava/iptal satirlari satis aggregation'dan haric
- EU aggregate: de+fr+it+es+others → tek `eu` channel
- SP-API region = tum ulkeler (credential basina tek cagri yeterli)
- Amazon Ads `cost` vs `spend`: targeting/advertised → `cost`, search_term → `spend`

## Lokal kurulum
```bash
cd backend
cp .env.example .env   # DB credentials + SLACK_WEBHOOK_URL
npm install
npm run dev            # http://localhost:3008
```
Sunucu DB'sine erisim icin SSH tunnel:
```bash
ssh -L 5433:localhost:5432 -p 2222 root@78.47.117.36
```

## Deploy
`git push origin main` → GitHub Actions → sunucu (otomatik, PM2 restart).
Migration varsa ONCE sunucuda calistir:
```bash
ssh -p 2222 root@78.47.117.36 "sudo -u postgres psql -d databridge_db -f /path/to/migration.sql"
```

## Monitoring
- `/health` — DB baglantisi + uptime + memory (public)
- `/api/v1/status` — Detayli sync durumu, SKU match kalitesi (auth)
- `/api/v1/status/sync/health` — Job bazli saglik (public, 200/503)

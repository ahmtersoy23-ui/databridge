# DataBridge

Marketplace **veri merkezi**. Amazon (SP-API + Ads), Wayfair, Walmart, Bol, Takealot,
Kaufland, Wisersell, FedEx, Veeqo'dan veri ceker → normalize eder → `pricelab_db`'ye yazar.
**Downstream tum app'ler buna bagimli** (StockPulse, AmzSellMetrics, PriceLab, ManuMaestro).
Bu yuzden sessiz veri kaybi/bozulmasi en buyuk risk — asagidaki invariant'lar bunu onler.

> Cross-app kurallar (paylasimli DB, deploy, lint, Node versiyon) `apps/CLAUDE.md`'de.
> Burada sadece DataBridge'e ozel olan var.

## Komutlar
```bash
cd backend && npm run dev    # lokal (port 3008), SSH tunnel gerekir (port 5433)
cd backend && npm test       # vitest (136 test)
cd backend && npm run lint   # eslint src — commit ONCESI zorunlu
cd backend && npm run build  # tsc
```

## DB pool'lari (`config/database.ts`)
- **`pool`** → `databridge_db` (kendi): raw_orders, *_raw_orders, wayfair_*, ads_*, sync_log, oms_shipments, credentials
- **`sharedPool`** → `pricelab_db` (YAZAR): `sales_data`, `fba_inventory`, `channel_prices`
- `amz_transactions` ARTIK SP-API'den **yazilmiyor** — sadece Excel upload besler. `transactionDataWriter` cron'a bagli degil (sadece test import eder).

## Degismez kurallar (invariant)

Her yeni sync/writer bunlara uymak ZORUNDA — veri merkezi guvenligi bunlara dayanir:

1. **Yeni cron job → `withSyncLog('job-name', fn)` ile sar.** Bu olmadan: sync_log kaydi yok, fail alarmı yok, satir-dususu alarmı yok. (`utils/syncLog.ts`)
2. **`sharedPool`'a (sales_data/fba_inventory) yazan her writer → %20 safety threshold.** Yeni veri mevcudun `getSafetyDropThreshold(JOB)` katindan (default **0.2**) azsa YAZMA + Slack alert. Ornek: `salesDataWriter.ts:216`, `inventoryDataWriter.ts:154`. (`utils/safetyThreshold.ts`)
3. **Disa cagri → `withRetry(fn, { label })` ile sar.** Default 3 deneme, exponential backoff (5s→20s→45s), 429/5xx/network transient sayilir. (`utils/retry.ts`)
4. **Amazon SKU sorgulari → `sku NOT LIKE 'amzn.gr.%'`** (iade SKU'lari) **ve sales aggregation'da `item_price > 0`** (bedava/iptal satirlari). Sadece Amazon kanallari icin (`salesDataWriter.ts:45-46`).
5. **EU aggregate**: de+fr+it+es+others → tek `eu` channel olarak yazilir.
6. **SP-API region = tum ulkeler**: credential basina tek cagri yeterli, ulke ulke dolanma.
7. **Slack alert → `notify(text)`** (`utils/notify.ts`): primary + backup webhook, ikisi de duserse PM2 stdout'a `ALARM_DELIVERY_FAIL`. Env: `SLACK_WEBHOOK_URL`, `SLACK_WEBHOOK_URL_BACKUP`.

## Cron job'lar
**Tek dogru kaynak = `config/constants.ts`** (schedule sabitleri) + `services/sync/scheduler.ts` (kayit).
Schedule'lari burada tekrar listeleme — bayatliyor. Gruplar:

| Grup | Job'lar | Hedef |
|------|---------|-------|
| **SP-API** | inventory, sales, transactions, aging, business-report, fee-rates | fba_inventory, sales_data, raw_orders |
| **Ads** | ads (SP), sb-ads, sd-ads, campaign-snapshot, brand-analytics | ads_*_report |
| **Marketplace orders** | walmart, bol, takealot, kaufland | *_raw_orders → sales_data |
| **Wisersell** | catalog, orders, pending, routing-poll (20dk), shipment | wisersell_*, oms_shipments |
| **Lojistik/fiyat** | fedex-track full+delta, channel-prices | oms_shipments, channel_prices |
| **Denetim** | sku-master-diff (haftalik), data-quality (gunluk) | Slack ozet |

- **Marketplace order writer'lari** sales_data'ya `upsertSalesData()` (salesDataWriter) uzerinden yazar → %20 threshold otomatik miras alinir.
- **FedEx full vs delta** ayri job: farkli beklenen satir sayisi → dogru row-drop baseline.
- **Review tracking** sunucuda DEGIL — lokal Mac'te launchd ile (residential IP, rate-limit). Kod: `local-review-fetcher/`.

## Servis ekleme akisi (yeni marketplace/kaynak)
1. `services/<kaynak>/` altinda client + sync yaz.
2. sales_data'ya yaziyorsan `upsertSalesData()` cagir (threshold ucretsiz gelir); kendi tablona yaziyorsan writer'a `getSafetyDropThreshold(JOB)` ekle.
3. `scheduler.ts`'te `withSyncLog` + `withRetry` ile kaydet, schedule sabitini `constants.ts`'e ekle.
4. **Test yaz** — sync mantigini `vi.mock('pool')` ile test et (kalip: `__tests__/wayfairSync.test.ts`).
5. SYSTEM.md'yi guncelle (agent haritasi) — yeni tablo/kolon eklediyse.

## Endpoint'ler (`routes/index.ts`)
- **Public (no auth)**: `/status` (UptimeRobot), `/amazonsales` + `/amazonfba` + `/catalog` (StockPulse cekiyor — catalog read-only wisersell_products), `/health`
- **adminOpsAuth (API key ya da SSO)**: `/sync` (manuel tetik), `/wisersell-routing` + `/veeqo-routing` + `/amazon-order-status` (s2s)
- **SSO-gated**: digerleri (orders, inventory-detail, */settings, */orders, ads, reviews, credentials...)
- Manuel sync tetik: `POST /api/v1/sync` body `{"type":"channel_prices"}` (INTERNAL_API_KEY header).

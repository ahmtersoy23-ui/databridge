# DataBridge

Marketplace veri hub'i. Amazon SP-API, Amazon Ads ve Wayfair'den veri ceker, normalize eder, diger app'lerin kullanacagi formata donusturur.

## Stack
Express TS + PostgreSQL + node-cron + Winston

## Veritabanlari

**databridge_db** (kendi): raw_orders, fba_inventory, wayfair_*, ads_*, sync_log
**pricelab_db** (paylasimli, YAZAR): sales_data, fba_inventory (aggregate), amz_transactions

## Cron Job'lar

| Job | Schedule | Kaynak | Hedef |
|-----|----------|--------|-------|
| inventory | `*/8 saat` | SP-API getInventorySummaries | fba_inventory |
| sales | `03:00 UTC` | SP-API getOrders (son 5 gun) | raw_orders → sales_data |
| transactions | `05:00 UTC` | Finances API | financial_transactions → amz_transactions |
| wayfair | `01/09/17 UTC` | Wayfair GraphQL (Shukran + MDN) | wayfair_orders + wayfair_inventory |
| ads | `06:00 UTC` | Amazon Ads V3 (4 rapor) | ads_*_report |
| aging | `02:00 UTC` | SP-API PLANNING_DATA | fba_inventory_aging |
| nj-warehouse | `*/8 saat` | NJ API | nj_warehouse |
| wisersell | `04/12/20 UTC` | Wisersell API | wisersell_catalog |

Tum job'lar `sync_log` tablosuna yazilir. Fail durumunda Slack'e bildirim gider.

## Guvenlik Mekanizmalari

- **Write safety**: sales_data ve fba_inventory yazarken, yeni veri eskisinin %20'sinden azsa YAZILMAZ (veri kaybi onleme)
- **sync_log**: Her job'un basari/basarisizlik, sure, satir sayisi kaydi
- **Row count anomali**: Onceki calismaya gore %80+ dususte Slack uyarisi
- **Retry**: 3 deneme, exponential backoff (5s → 20s → 45s)

## Onemli Kurallar

- `sku NOT LIKE 'amzn.gr.%'` — iade SKU'lari her yerde filtrelenir
- `item_price > 0` — bedava urunler satis aggregation'dan haric
- EU aggregate: de+fr+it+es+others → 'eu' channel olarak yazilir
- SP-API region = tum ulkeler (credential basina tek cagri yeterli)
- Amazon Ads `cost` vs `spend`: targeting/advertised → `cost`, search_term → `spend`

## Lokal Kurulum

```bash
cd backend
cp .env.example .env  # DB credentials, SLACK_WEBHOOK_URL ekle
npm install
npm run dev           # http://localhost:3008
```

SSH tunnel gerekli (sunucu DB'sine erisim):
```bash
ssh -L 5433:localhost:5432 -p 2222 root@78.47.117.36
```

## Deploy

`git push origin main` → GitHub Actions → sunucu. Otomatik.
Migration varsa once sunucuda calistir:
```bash
ssh -p 2222 root@78.47.117.36 "sudo -u postgres psql -d databridge_db -f /path/to/migration.sql"
```

## Monitoring

- `/health` — DB baglantisi + uptime + memory (public, no auth)
- `/api/v1/status` — Detayli sync durumu, SKU match kalitesi (auth gerekli)
- `/api/v1/status/sync/health` — Job bazli saglik (public, 200/503)

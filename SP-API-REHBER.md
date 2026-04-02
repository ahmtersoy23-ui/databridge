# Amazon SP-API Credentials Alma Rehberi

DataBridge uygulamasi icin Amazon Selling Partner API (SP-API) credentials'larini adim adim nasil alinacagini anlatan rehber.

---

## Genel Bakis

SP-API'ye baglanmak icin 3 temel bilgi gerekiyor:

| Bilgi | Nereden | Ornek |
|-------|---------|-------|
| **Client ID** | LWA App kaydinden | `amzn1.application-oa2-client.abc123...` |
| **Client Secret** | LWA App kaydinden | `amzn1.oa2-cs.v1.abc123...` |
| **Refresh Token** | Self-authorization | `Atzr\|abc123...` |

Ayrica **Seller ID** lazim (Account Info'dan alinir).

---

## Adim 1: Seller Central'a Giris

Satici hesabinla giris yap:

- **US marketplace:** https://sellercentral.amazon.com
- **EU marketplace:** https://sellercentral-europe.amazon.com
- **AU marketplace:** https://sellercentral.amazon.com.au

> Birden fazla marketplace'in varsa her region icin ayri giris yapman gerekebilir.

---

## Adim 2: Seller ID'ni Bul

1. Seller Central'da sag ustten **Settings** (Ayarlar) menusune tikla
2. **Account Info** (Hesap Bilgileri) sec
3. **Your Merchant Token** veya **Seller ID** alanini bul
4. `A2ABC123DEF456` gibi bir deger olacak — kopyala ve sakla

> Bu degeri DataBridge Settings sayfasindaki "Seller ID" alanina gireceksin.

---

## Adim 3: Developer Profil Olustur

Eger daha once developer kaydı yapilmadiysa:

1. Seller Central → **Apps and Services** → **Develop Apps** menusune git
2. Sistem seni **Developer Registration** sayfasina yonlendirecek
3. Formu doldur:
   - **Organization Name:** Sirket/isletme adin
   - **Primary Contact:** Ad, email, telefon
   - **Data Protection:** Veri koruma bilgileri (Privacy Policy URL vs.)
4. **Register** butonuna tikla
5. Onay genellikle aninda gelir, bazen 1-2 gun surebilir

> Daha once baska uygulama icin developer olarak kayit olduysan bu adim zaten tamamlanmis olabilir. "Develop Apps" sayfasinda mevcut uygulamalar gorunur.

---

## Adim 4: Uygulama Kaydi (App Registration)

### 4a: IAM Role Olustur (AWS tarafinda)

SP-API, bir AWS IAM ARN istiyor. Bunun icin:

1. https://console.aws.amazon.com adresine git (AWS hesabin yoksa ucretsiz olustur)
2. **IAM** servisine git
3. Sol menuden **Policies** → **Create Policy** → JSON sekmesi:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "execute-api:Invoke",
      "Resource": "arn:aws:execute-api:*:*:*"
    }
  ]
}
```

4. Policy adi: `SellingPartnerAPIPolicy` → Kaydet
5. Sol menuden **Roles** → **Create Role**:
   - Trusted entity: **Another AWS account**
   - Account ID: Kendi AWS Account ID'ni gir
   - Olusturdugum policy'yi ekle
   - Role adi: `SellingPartnerAPIRole`
6. Role olusturulduktan sonra **Role ARN**'i kopyala: `arn:aws:iam::123456789012:role/SellingPartnerAPIRole`

### 4b: SP-API Uygulamasini Kaydet

1. Seller Central → **Apps and Services** → **Develop Apps**
2. **Add new app client** tikla
3. Formu doldur:
   - **App name:** `DataBridge`
   - **API Type:** `SP API`
   - **IAM ARN:** Adim 4a'dan kopyaladigin Role ARN
4. Roller (Roles) icin su izinleri sec:
   - **Direct-to-Consumer Shipping** (opsiyonel)
   - **Inventory and Order Management** (ZORUNLU — envanter + siparis verileri icin)
   - **SP-API Reports** (ZORUNLU — report API icin)
   - **Finance and Accounting** (Phase 2 icin — transaction verileri)
5. **Save and Exit** tikla

---

## Adim 5: LWA Credentials Al (Client ID & Secret)

Uygulama kaydedildikten sonra:

1. **Develop Apps** sayfasinda uygulamanin yaninda **View** veya **LWA Credentials** linkine tikla
2. **Client ID** gorunecek → kopyala
   - Ornek: `amzn1.application-oa2-client.abc123def456...`
3. **Client Secret** → **Show secret** tikla → kopyala
   - Ornek: `amzn1.oa2-cs.v1.abc123def456...`

> **ONEMLI:** Client Secret sadece bir kez gosterilir. Kaybedersen yeniden olusturman gerekir.

---

## Adim 6: Self-Authorization (Refresh Token Al)

1. **Develop Apps** sayfasinda uygulamanin yaninda **Authorize** butonuna tikla
2. **Generate refresh token** veya **Authorize app** butonuna tikla
3. Sistem bir **Refresh Token** uretecek
   - Ornek: `Atzr|IwEBIBx...`
4. Bu token'i kopyala ve guvenli sakla

> **ONEMLI:** Refresh Token'i kaybetme! Tekrar almak icin ayni islemi yapabilirsin ama eski token gecersiz olabilir.

> **NOT:** Birden fazla marketplace/region'in varsa (US + EU gibi), her region icin ayri Seller Central hesabindan ayri authorize yapman gerekiyor. Her biri ayri refresh token uretir.

---

## Adim 7: DataBridge'e Credentials Gir

Tum bilgileri topladiktan sonra:

1. Tarayicidan `http://localhost:5173/settings` ac
2. Formu doldur:

| Alan | Deger |
|------|-------|
| **Region** | NA (US/CA), EU (UK/DE/FR/IT/ES), FE (AU) |
| **Seller ID** | Adim 2'den |
| **Client ID** | Adim 5'ten |
| **Client Secret** | Adim 5'ten |
| **Refresh Token** | Adim 6'dan |

3. **Save Credentials** tikla
4. Birden fazla region varsa her biri icin ayri kayit yap

---

## Adim 8: Ilk Sync'i Test Et

1. `http://localhost:5173` Dashboard'a git
2. **Sync Inventory** butonuna tikla
3. Logs sayfasindan (`/logs`) sync durumunu takip et
4. Basarili olursa Dashboard'da inventory sayisi gorunecek

---

## Region - Marketplace Eslesmesi

| Region | Marketplace'ler | Seller Central |
|--------|----------------|----------------|
| **NA** | US, CA, MX | sellercentral.amazon.com |
| **EU** | UK, DE, FR, IT, ES, NL, PL, SE | sellercentral-europe.amazon.com |
| **FE** | AU, JP, SG | sellercentral.amazon.com.au |

> Tek bir EU credentials ile tum Avrupa marketplace'lerine erisebilirsin. Ayni sekilde NA credentials US + CA + MX icin gecerli.

---

## Sorun Giderme

### "Unauthorized" hatasi
- Client ID/Secret dogru mu kontrol et
- Refresh Token'in suresi dolmus olabilir — yeniden authorize yap

### "Access denied" hatasi
- Uygulamanin roller (roles) bolumunde gerekli izinleri sectin mi?
- IAM Role ARN dogru mu?

### "Throttled" hatasi
- SP-API rate limit'e takildin. DataBridge otomatik olarak bekleyip tekrar dener (`auto_request_throttled: true`)

### Token yenileme
- Refresh token'lar suresiz gecerlidir ama Amazon yillik yenileme onermektedir
- Yeniden authorize yaparak yeni token alabilirsin

---

## Kaynaklar

- SP-API Onboarding: https://developer-docs.amazon.com/sp-api/docs/onboarding-overview
- Self-Authorization: https://developer-docs.amazon.com/sp-api/docs/self-authorization
- LWA Token Exchange: https://developer.amazon.com/docs/login-with-amazon/refresh-token.html
- SP-API Dokumantasyon: https://developer-docs.amazon.com/sp-api/

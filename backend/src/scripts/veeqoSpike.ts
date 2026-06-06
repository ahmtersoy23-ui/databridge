import 'dotenv/config';
import axios, { AxiosError } from 'axios';

/**
 * Veeqo API keşif spike'ı — READ-ONLY. Hiçbir etiket SATIN ALINMAZ.
 * Amaç: canlı hesabın gerçek şeklini görüp entegrasyon kararlarını kapatmak
 *   (key aktif mi, order eşleme anahtarı, allocation_id dönüyor mu, carrier id'leri).
 *
 * Auth: özel entegrasyon → `x-api-key` header. Key env'den (KODA GÖMME):
 *   VEEQO_API_KEY=... npx ts-node src/scripts/veeqoSpike.ts [amazonOrderNumber]
 *
 * Opsiyonel 2. arg: bir gerçek Amazon order number → `?query=` ile eşleme testi.
 * Rate limit: 5 req/s leaky-bucket; spike az çağrı yapar, throttle gerekmez.
 */

const BASE = process.env.VEEQO_API_BASE || 'https://api.veeqo.com';

function client() {
  const apiKey = process.env.VEEQO_API_KEY;
  if (!apiKey) {
    console.error('VEEQO_API_KEY env değişkeni gerekli (koda gömme). Örn: VEEQO_API_KEY=... npx ts-node src/scripts/veeqoSpike.ts');
    process.exit(1);
  }
  return axios.create({
    baseURL: BASE,
    headers: { accept: 'application/json', 'x-api-key': apiKey },
    timeout: 20_000,
    // 4xx'i de yakalayıp loglayalım (key kapalı = 401/403 bulgusu)
    validateStatus: () => true,
  });
}

function dump(label: string, status: number, data: unknown, max = 1500): void {
  const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  console.log(`\n=== ${label} → HTTP ${status} ===`);
  console.log(body.length > max ? body.slice(0, max) + `\n…(${body.length} char, kısaltıldı)` : body);
}

async function get(c: ReturnType<typeof client>, path: string, label: string): Promise<any> {
  try {
    const res = await c.get(path);
    dump(`${label}  GET ${path}`, res.status, res.data);
    return { status: res.status, data: res.data };
  } catch (err) {
    const ax = err as AxiosError;
    dump(`${label}  GET ${path} [HATA]`, ax.response?.status ?? 0, ax.response?.data ?? ax.message);
    return { status: ax.response?.status ?? 0, data: ax.response?.data };
  }
}

async function main(): Promise<void> {
  const amazonOrderNumber = process.argv[2];
  const c = client();
  console.log(`[veeqoSpike] base=${BASE}  amazonOrderNumber=${amazonOrderNumber ?? '(verilmedi)'}`);

  // 1) Key aktif mi? — en küçük çağrı
  const orders = await get(c, '/orders?page_size=3', '1) orders (key check)');
  if (orders.status === 401 || orders.status === 403) {
    console.log('\n⚠️  Key reddedildi (401/403). Veeqo support API key erişimini açmamış olabilir → ilk aksiyon: support.');
  }

  // 2) Hesabın carrier'ları ve teslim yöntemleri (cheapest-US hangi id?)
  await get(c, '/carriers', '2a) carriers');
  await get(c, '/delivery_methods', '2b) delivery_methods');

  // 3) Amazon order no ile eşleme — query çalışıyor mu?
  let sampleOrderId: number | string | undefined;
  if (amazonOrderNumber) {
    const q = await get(c, `/orders?query=${encodeURIComponent(amazonOrderNumber)}&page_size=5`, '3) orders?query=<amazonOrderNumber>');
    const arr = Array.isArray(q.data) ? q.data : q.data?.orders;
    if (Array.isArray(arr) && arr.length) {
      sampleOrderId = arr[0]?.id;
      console.log(`\n[veeqoSpike] query ${arr.length} sonuç döndü. number alanları:`,
        arr.slice(0, 5).map((o: any) => ({ id: o.id, number: o.number, status: o.status })));
    } else {
      console.log('\n⚠️  query sonuç döndürmedi → eşleme anahtarı `query` olmayabilir, alternatif alan aranmalı.');
    }
  }

  // 4) Tek order detayı — allocations[] / allocation_id gerçekten geliyor mu?
  if (!sampleOrderId) {
    const arr = Array.isArray(orders.data) ? orders.data : orders.data?.orders;
    sampleOrderId = Array.isArray(arr) && arr.length ? arr[0]?.id : undefined;
  }
  if (sampleOrderId) {
    const det = await get(c, `/orders/${sampleOrderId}`, `4) order detail (${sampleOrderId})`);
    const o = det.data;
    if (o) {
      console.log('\n[veeqoSpike] order top-level keys:', Object.keys(o).sort());
      console.log('[veeqoSpike] status:', o.status, '| allocated_completely:', o.allocated_completely);
      const allocs = o.allocations;
      console.log('[veeqoSpike] allocations:', Array.isArray(allocs)
        ? allocs.map((a: any) => ({ id: a?.id, warehouse_id: a?.warehouse_id, status: a?.status }))
        : allocs);
    }
  } else {
    console.log('\n[veeqoSpike] Örnek order id bulunamadı → allocation probe atlandı.');
  }

  console.log('\n[veeqoSpike] bitti. Bulgular: key durumu, carrier id\'leri, query eşleme, allocation_id varlığı.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[veeqoSpike] FATAL:', err);
    process.exit(1);
  });

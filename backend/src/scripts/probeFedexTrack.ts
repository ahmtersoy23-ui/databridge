import 'dotenv/config';
import { trackBatch } from '../services/fedex/client';

/**
 * Tek tracking için FedEx Track API çağrısı + raw response dump.
 * Amaç: shipper view (zengin) vs general public view (sınırlı) farkını gözlemlemek.
 *
 * Run: npx ts-node src/scripts/probeFedexTrack.ts <tracking_number>
 */

async function main(): Promise<void> {
  const tn = process.argv[2];
  if (!tn) {
    console.error('Tracking number parametresi gerekli');
    process.exit(1);
  }

  console.log(`[probe] FedEx Track API çağrısı: ${tn}`);
  const results = await trackBatch([tn]);
  if (results.length === 0) {
    console.log('[probe] Boş response');
    return;
  }
  const r = results[0];
  console.log(`[probe] notFound: ${r.notFound}`);
  if (r.errorMessage) console.log(`[probe] error: ${r.errorMessage}`);

  if (r.raw) {
    console.log('\n--- shipperInformation ---');
    console.log(JSON.stringify(r.raw.shipperInformation || null, null, 2));
    console.log('\n--- recipientInformation ---');
    console.log(JSON.stringify(r.raw.recipientInformation || null, null, 2));
    console.log('\n--- additionalTrackingInfo ---');
    console.log(JSON.stringify(r.raw.additionalTrackingInfo || null, null, 2));
    console.log('\n--- packageDetails (özet) ---');
    console.log(JSON.stringify(r.raw.packageDetails || null, null, 2));
    console.log('\n--- top-level keys ---');
    console.log(Object.keys(r.raw).sort());
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[probe] FATAL:', err);
    process.exit(1);
  });

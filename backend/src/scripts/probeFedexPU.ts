import 'dotenv/config';
import { trackBatch } from '../services/fedex/client';

async function main(): Promise<void> {
  const tns = process.argv.slice(2);
  if (tns.length === 0) {
    console.error('Tracking number(lar) gerekli');
    process.exit(1);
  }
  const results = await trackBatch(tns);
  for (const r of results) {
    console.log(`\n=== ${r.trackingNumber} (notFound=${r.notFound}) ===`);
    if (r.raw) {
      const ids = r.raw.additionalTrackingInfo?.packageIdentifiers;
      const ref = Array.isArray(ids) ? ids.find((x: any) => x?.type === 'SHIPPER_REFERENCE')?.values?.[0] : null;
      console.log(`SHIPPER_REFERENCE: ${ref || '(yok)'}`);
      const events = r.raw.scanEvents || [];
      const pu = events.find((e: any) => e.eventType === 'PU' || e.eventDescription?.toLowerCase()?.includes('picked up'));
      const oc = events.find((e: any) => e.eventType === 'OC');
      if (pu) {
        const loc = pu.scanLocation || {};
        console.log(`PU @ ${pu.date}: ${loc.city || '-'} / ${loc.stateOrProvinceCode || '-'} / ${loc.countryCode || '-'} (postal: ${loc.postalCode || '-'})`);
      } else {
        console.log('PU event yok');
      }
      if (oc) {
        const loc = oc.scanLocation || {};
        console.log(`OC @ ${oc.date}: ${loc.city || '-'} / ${loc.countryCode || '-'}`);
      }
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error('FATAL:', err); process.exit(1); });

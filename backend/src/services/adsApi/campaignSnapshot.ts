import { pool } from '../../config/database';
import { getAdsClient, getActiveProfiles } from './client';
import { withRetry } from '../../utils/retry';
import logger from '../../config/logger';

const BATCH_SIZE = 500;

/**
 * Fetch campaigns/list and productAds/list for a profile,
 * write daily snapshot to ads_campaigns_snapshot + ads_product_ads_snapshot.
 */
export async function syncCampaignSnapshot(
  credentialId: number,
  profileId: number,
): Promise<{ campaigns: number; productAds: number }> {
  const client = await getAdsClient(credentialId, profileId);
  const today = new Date().toISOString().split('T')[0];

  // --- Campaigns ---
  let campaignTotal = 0;
  let nextToken: string | undefined;

  do {
    const body: any = { maxResults: 1000 };
    if (nextToken) body.nextToken = nextToken;

    const res = await client.post('/sp/campaigns/list', body, {
      headers: { 'Content-Type': 'application/vnd.spCampaign.v3+json', 'Accept': 'application/vnd.spCampaign.v3+json' },
    });

    const campaigns = res.data?.campaigns || [];
    nextToken = res.data?.nextToken;

    if (campaigns.length === 0) break;

    const values: any[] = [];
    const placeholders: string[] = [];
    const COLS = 12;

    for (let j = 0; j < campaigns.length; j++) {
      const c = campaigns[j];
      const offset = j * COLS;
      placeholders.push(`(${Array.from({ length: COLS }, (_, k) => `$${offset + k + 1}`).join(', ')})`);
      values.push(
        profileId,
        c.campaignId,
        c.name || null,
        c.campaignType || null,
        c.targetingType || null,
        c.state || null,
        c.budget?.budget ?? null,
        c.startDate || null,
        c.endDate || null,
        c.dynamicBidding?.strategy || null,
        c.portfolioId || null,
        today,
      );
    }

    await pool.query(
      `INSERT INTO ads_campaigns_snapshot (
        profile_id, campaign_id, campaign_name, campaign_type, targeting_type,
        state, daily_budget, start_date, end_date, bidding_strategy, portfolio_id, snapshot_date
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT (profile_id, campaign_id, snapshot_date)
      DO UPDATE SET
        campaign_name = EXCLUDED.campaign_name,
        campaign_type = EXCLUDED.campaign_type,
        targeting_type = EXCLUDED.targeting_type,
        state = EXCLUDED.state,
        daily_budget = EXCLUDED.daily_budget,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        bidding_strategy = EXCLUDED.bidding_strategy,
        portfolio_id = EXCLUDED.portfolio_id,
        synced_at = NOW()`,
      values,
    );

    campaignTotal += campaigns.length;
  } while (nextToken);

  logger.info(`[CampaignSnapshot] Campaigns: ${campaignTotal} for profile ${profileId}`);

  // --- Product Ads ---
  let adTotal = 0;
  nextToken = undefined;

  do {
    const body: any = { maxResults: 5000 };
    if (nextToken) body.nextToken = nextToken;

    const res = await client.post('/sp/productAds/list', body, {
      headers: { 'Content-Type': 'application/vnd.spProductAd.v3+json', 'Accept': 'application/vnd.spProductAd.v3+json' },
    });

    const ads = res.data?.productAds || [];
    nextToken = res.data?.nextToken;

    if (ads.length === 0) break;

    // Batch write
    for (let i = 0; i < ads.length; i += BATCH_SIZE) {
      const batch = ads.slice(i, i + BATCH_SIZE);
      const values: any[] = [];
      const placeholders: string[] = [];
      const COLS = 8;

      for (let j = 0; j < batch.length; j++) {
        const a = batch[j];
        const offset = j * COLS;
        placeholders.push(`(${Array.from({ length: COLS }, (_, k) => `$${offset + k + 1}`).join(', ')})`);
        values.push(
          profileId,
          a.adId,
          a.campaignId,
          a.adGroupId,
          a.asin || null,
          a.sku || null,
          a.state || null,
          today,
        );
      }

      await pool.query(
        `INSERT INTO ads_product_ads_snapshot (
          profile_id, ad_id, campaign_id, ad_group_id, asin, sku, state, snapshot_date
        ) VALUES ${placeholders.join(', ')}
        ON CONFLICT (profile_id, ad_id, snapshot_date)
        DO UPDATE SET
          campaign_id = EXCLUDED.campaign_id,
          ad_group_id = EXCLUDED.ad_group_id,
          asin = EXCLUDED.asin,
          sku = EXCLUDED.sku,
          state = EXCLUDED.state,
          synced_at = NOW()`,
        values,
      );

      adTotal += batch.length;
    }
  } while (nextToken);

  logger.info(`[CampaignSnapshot] Product Ads: ${adTotal} for profile ${profileId}`);
  return { campaigns: campaignTotal, productAds: adTotal };
}

/**
 * Sync campaign snapshots for all active profiles.
 */
export async function syncAllCampaignSnapshots(): Promise<void> {
  const profiles = await getActiveProfiles();

  if (!profiles.length) {
    logger.info('[CampaignSnapshot] No active Ads profiles found');
    return;
  }

  logger.info(`[CampaignSnapshot] Starting snapshot for ${profiles.length} profiles`);

  for (const profile of profiles) {
    try {
      const { campaigns, productAds } = await withRetry(
        () => syncCampaignSnapshot(profile.credential_id, profile.profile_id),
        { label: `campaign-snapshot:${profile.profile_id}`, maxRetries: 2 },
      );
      logger.info(`[CampaignSnapshot] Profile ${profile.profile_id} (${profile.country_code}): ${campaigns} campaigns, ${productAds} product ads`);
    } catch (err: any) {
      logger.error(`[CampaignSnapshot] Profile ${profile.profile_id} (${profile.country_code}) failed: ${err.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, 3_000));
  }

  logger.info('[CampaignSnapshot] Snapshot cycle complete');
}

// Amazon Ads API type definitions

export interface AdsApiProfile {
  id: number;
  credential_id: number;
  profile_id: number;  // Amazon Ads profile ID (bigint)
  country_code: string;
  marketplace_id: string | null;
  account_name: string | null;
  account_type: string | null;  // 'seller' | 'vendor'
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

// Amazon Ads API profile response from GET /v2/profiles
export interface AdsProfileResponse {
  profileId: number;
  countryCode: string;
  currencyCode: string;
  dailyBudget: number;
  timezone: string;
  accountInfo: {
    marketplaceStringId: string;
    id: string;
    type: 'seller' | 'vendor';
    name: string;
  };
}

// Report type enum
export type AdsReportType = 'search_term' | 'targeting' | 'advertised_product' | 'purchased_product';

// Ads API V3 report request config
export interface AdsReportConfig {
  reportTypeId: string;
  groupBy: string[];
  columns: string[];
  reportDate: string;  // YYYY-MM-DD
  timeUnit: 'SUMMARY';
  format: 'GZIP_JSON';
}

// Ads API V3 report status response
export interface AdsReportStatusResponse {
  reportId: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  url?: string;        // Download URL when COMPLETED
  fileSize?: number;
  failureReason?: string;
}

// ---- Row types matching Excel column structure ----

export interface SearchTermReportRow {
  date: string;
  portfolioName: string;
  currency: string;
  campaignName: string;
  campaignId: number;
  adGroupName: string;
  adGroupId: number;
  countryName: string;
  targeting: string;
  matchType: string;
  searchTerm: string;
  impressions: number;
  clicks: number;
  clickThroughRate: number;
  costPerClick: number;
  spend: number;
  sales7d: number;
  acos: number;
  roas: number;
  orders7d: number;
  unitsSold7d: number;
  conversionRate: number;
  advertisedSkuUnits7d: number;
  otherSkuUnits7d: number;
  advertisedSkuSales7d: number;
  otherSkuSales7d: number;
}

export interface TargetingReportRow {
  date: string;
  portfolioName: string;
  currency: string;
  campaignName: string;
  campaignId: number;
  countryName: string;
  adGroupName: string;
  adGroupId: number;
  targeting: string;
  matchType: string;
  impressions: number;
  topOfSearchImpressionShare: number;
  clicks: number;
  clickThroughRate: number;
  costPerClick: number;
  spend: number;
  acos: number;
  roas: number;
  sales7d: number;
  orders7d: number;
  unitsSold7d: number;
  conversionRate: number;
  advertisedSkuUnits7d: number;
  otherSkuUnits7d: number;
  advertisedSkuSales7d: number;
  otherSkuSales7d: number;
}

export interface AdvertisedProductReportRow {
  date: string;
  portfolioName: string;
  currency: string;
  campaignName: string;
  campaignId: number;
  adGroupName: string;
  adGroupId: number;
  countryName: string;
  advertisedSku: string;
  advertisedAsin: string;
  impressions: number;
  clicks: number;
  clickThroughRate: number;
  costPerClick: number;
  spend: number;
  sales7d: number;
  acos: number;
  roas: number;
  orders7d: number;
  unitsSold7d: number;
  conversionRate: number;
  advertisedSkuUnits7d: number;
  otherSkuUnits7d: number;
  advertisedSkuSales7d: number;
  otherSkuSales7d: number;
}

export interface PurchasedProductReportRow {
  date: string;
  portfolioName: string;
  campaignName: string;
  campaignId: number;
  countryName: string;
  currency: string;
  adGroupName: string;
  adGroupId: number;
  advertisedSku: string;
  advertisedAsin: string;
  targeting: string;
  matchType: string;
  purchasedAsin: string;
  otherSkuUnits7d: number;
  otherSkuOrders7d: number;
  otherSkuSales7d: number;
}

// Sync job tracking
export interface AdsSyncJob {
  id: number;
  profile_id: number;
  report_type: AdsReportType;
  report_date: string | null;
  date_start: string | null;
  date_end: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  amazon_report_id: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  records_processed: number;
  error_message: string | null;
}

// Report type → API reportTypeId mapping
export const ADS_REPORT_TYPE_MAP: Record<AdsReportType, string> = {
  search_term: 'spSearchTerm',
  targeting: 'spTargeting',
  advertised_product: 'spAdvertisedProduct',
  purchased_product: 'spPurchasedProduct',
};

// Columns requested per report type (Ads API V3 — validated against API schema)
export const ADS_REPORT_COLUMNS: Record<AdsReportType, string[]> = {
  search_term: [
    'date', 'portfolioId', 'campaignName', 'campaignId', 'campaignBudgetCurrencyCode',
    'adGroupName', 'adGroupId', 'targeting', 'matchType',
    'searchTerm', 'impressions', 'clicks', 'clickThroughRate', 'costPerClick',
    'spend', 'sales7d', 'acosClicks7d', 'roasClicks7d', 'purchases7d', 'unitsSoldClicks7d',
    'purchasesSameSku7d', 'unitsSoldSameSku7d', 'unitsSoldOtherSku7d',
    'attributedSalesSameSku7d', 'salesOtherSku7d',
  ],
  targeting: [
    'date', 'portfolioId', 'campaignName', 'campaignId', 'campaignBudgetCurrencyCode',
    'adGroupName', 'adGroupId', 'targeting', 'matchType',
    'impressions', 'topOfSearchImpressionShare', 'clicks', 'clickThroughRate',
    'costPerClick', 'cost', 'acosClicks7d', 'roasClicks7d', 'sales7d', 'purchases7d',
    'unitsSoldClicks7d', 'purchasesSameSku7d', 'unitsSoldSameSku7d', 'unitsSoldOtherSku7d',
    'attributedSalesSameSku7d', 'salesOtherSku7d',
  ],
  advertised_product: [
    'date', 'portfolioId', 'campaignName', 'campaignId', 'campaignBudgetCurrencyCode',
    'adGroupName', 'adGroupId',
    'impressions', 'clicks', 'clickThroughRate',
    'costPerClick', 'spend', 'sales7d', 'acosClicks7d', 'roasClicks7d',
    'purchases7d', 'unitsSoldClicks7d',
    'purchasesSameSku7d', 'unitsSoldSameSku7d', 'unitsSoldOtherSku7d',
    'attributedSalesSameSku7d', 'salesOtherSku7d',
  ],
  purchased_product: [
    'date', 'portfolioId', 'campaignName', 'campaignId',
    'campaignBudgetCurrencyCode', 'adGroupName', 'adGroupId',
    'targeting', 'matchType',
    'unitsSoldOtherSku7d', 'salesOtherSku7d',
  ],
};

// GroupBy per report type
export const ADS_REPORT_GROUP_BY: Record<AdsReportType, string[]> = {
  search_term: ['searchTerm'],
  targeting: ['targeting'],
  advertised_product: ['advertiser'],
  purchased_product: ['asin'],
};

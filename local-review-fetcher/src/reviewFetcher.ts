import axios from 'axios';
import * as cheerio from 'cheerio';
import logger from './config';

// --- Amazon domain + language config ---

export const AMAZON_DOMAINS: Record<string, { domain: string; lang: string }> = {
  US: { domain: 'amazon.com', lang: 'en-US,en;q=0.9' },
  UK: { domain: 'amazon.co.uk', lang: 'en-GB,en;q=0.9' },
  DE: { domain: 'amazon.de', lang: 'de-DE,de;q=0.9,en;q=0.5' },
  FR: { domain: 'amazon.fr', lang: 'fr-FR,fr;q=0.9,en;q=0.5' },
  IT: { domain: 'amazon.it', lang: 'it-IT,it;q=0.9,en;q=0.5' },
  ES: { domain: 'amazon.es', lang: 'es-ES,es;q=0.9,en;q=0.5' },
  CA: { domain: 'amazon.ca', lang: 'en-CA,en;q=0.9' },
  AU: { domain: 'amazon.com.au', lang: 'en-AU,en;q=0.9' },
  AE: { domain: 'amazon.ae', lang: 'en-AE,en;q=0.9' },
  SA: { domain: 'amazon.sa', lang: 'en-SA,en;q=0.9' },
};

// --- User-Agent rotation ---

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// --- Types ---

export interface ParsedReview {
  title: string;
  body: string;
  rating: number | null;
  date: string;
  author: string;
  isVerified: boolean;
}

export interface ReviewsPageResult {
  rating: number | null;
  reviewCount: number | null;
  reviews: ParsedReview[];
}

// --- CAPTCHA detection ---

function isCaptcha(html: string): boolean {
  const lower = html.toLowerCase();
  return lower.includes('captcha') ||
    lower.includes('api-services-support@amazon.com') ||
    lower.includes('sorry, we just need to make sure') ||
    lower.includes('type the characters you see');
}

// --- Fetch helpers ---

async function fetchPage(url: string, countryCode: string): Promise<string | null> {
  const config = AMAZON_DOMAINS[countryCode];
  if (!config) {
    logger.warn(`[ReviewFetcher] Unknown country code: ${countryCode}`);
    return null;
  }

  try {
    const ua = randomUA();
    const resp = await axios.get(url, {
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': config.lang,
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
        'Referer': `https://www.${config.domain}/`,
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        ...(ua.includes('Chrome') ? {
          'Sec-CH-UA': '"Chromium";v="131", "Not_A Brand";v="24"',
          'Sec-CH-UA-Mobile': '?0',
          'Sec-CH-UA-Platform': '"Windows"',
        } : {}),
      },
      timeout: 20_000,
      maxRedirects: 3,
      validateStatus: (s) => s < 400,
    });

    const html = typeof resp.data === 'string' ? resp.data : String(resp.data);

    if (isCaptcha(html)) {
      logger.warn(`[ReviewFetcher] CAPTCHA detected for ${url}`);
      return null;
    }

    return html;
  } catch (err: any) {
    if (err.response?.status === 503 || err.response?.status === 403) {
      logger.warn(`[ReviewFetcher] Blocked (${err.response.status}) for ${url}`);
      return null;
    }
    logger.error(`[ReviewFetcher] Fetch error for ${url}: ${err.message}`);
    return null;
  }
}

// --- Parse rating from review page header ---

function parseRating($: cheerio.CheerioAPI): number | null {
  const selectors = [
    '#acrPopover .a-icon-alt',
    'span[data-hook="rating-out-of-text"]',
    'i.a-icon-star span.a-icon-alt',
    '#averageCustomerReviews .a-icon-alt',
    'i[data-hook="average-star-rating"] span.a-icon-alt',
  ];

  for (const sel of selectors) {
    const text = $(sel).first().text().trim();
    if (text) {
      const match = text.match(/([\d.,]+)/);
      if (match) {
        const val = parseFloat(match[1].replace(',', '.'));
        if (val > 0 && val <= 5) return val;
      }
    }
  }

  return null;
}

// --- Parse review count from review page header ---

function parseReviewCount($: cheerio.CheerioAPI): number | null {
  const selectors = [
    '#acrCustomerReviewText',
    '#acrCustomerReviewLink span',
    'span[data-hook="total-review-count"]',
    '#averageCustomerReviews #acrCustomerReviewLink',
    'div[data-hook="cr-filter-info-review-rating-count"]',
  ];

  for (const sel of selectors) {
    const text = $(sel).first().text().trim();
    if (text) {
      const cleaned = text.replace(/[^\d]/g, '');
      const val = parseInt(cleaned, 10);
      if (!isNaN(val) && val >= 0) return val;
    }
  }

  return null;
}

// --- Parse single review element ---

function parseReviewElement(reviewEl: cheerio.Cheerio<any>, $: cheerio.CheerioAPI): ParsedReview {
  const title = reviewEl.find('a[data-hook="review-title"] span:not(.a-icon-alt)').text().trim()
    || reviewEl.find('[data-hook="review-title"]').text().trim();

  const rawBody = reviewEl.find('span[data-hook="review-body"] span').first().text().trim()
    || reviewEl.find('span[data-hook="review-body"]').text().trim();
  const body = rawBody.substring(0, 500);

  const ratingText = reviewEl.find('i[data-hook="review-star-rating"] span.a-icon-alt').text().trim()
    || reviewEl.find('i[data-hook="cmps-review-star-rating"] span.a-icon-alt').text().trim();
  let rating: number | null = null;
  if (ratingText) {
    const match = ratingText.match(/([\d.,]+)/);
    if (match) rating = parseFloat(match[1].replace(',', '.'));
  }

  const date = reviewEl.find('span[data-hook="review-date"]').text().trim();
  const author = reviewEl.find('span.a-profile-name').first().text().trim();
  const isVerified = reviewEl.find('span[data-hook="avp-badge"]').length > 0;

  return { title, body, rating, date, author, isVerified };
}

// --- Main: fetch product page (rating + count + reviews) ---
// Note: /product-reviews/ page now requires login, so we use /dp/ which
// returns rating, count AND ~8 recent reviews in server-rendered HTML.

export async function fetchReviewsPage(asin: string, countryCode: string): Promise<ReviewsPageResult | null> {
  const config = AMAZON_DOMAINS[countryCode];
  if (!config) return null;

  const url = `https://www.${config.domain}/dp/${asin}`;
  const html = await fetchPage(url, countryCode);
  if (!html) return null;

  try {
    const $ = cheerio.load(html);

    const rating = parseRating($);
    const reviewCount = parseReviewCount($);
    const reviews: ParsedReview[] = [];

    $('[data-hook="review"]').each((_i, el) => {
      reviews.push(parseReviewElement($(el), $));
    });

    if (rating === null && reviewCount === null && reviews.length === 0) {
      logger.warn(`[ReviewFetcher] Could not parse anything for ${asin} (${countryCode})`);
      return null;
    }

    return { rating, reviewCount, reviews };
  } catch (err: any) {
    logger.error(`[ReviewFetcher] Parse error for ${asin} (${countryCode}): ${err.message}`);
    return null;
  }
}

// --- Delay helper (~1 min average) ---

export function randomDelay(minMs: number = 50_000, maxMs: number = 70_000): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Shuffle (Fisher-Yates) — break sequential patterns ---

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

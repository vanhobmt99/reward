/**
 * Live query sourcing via Bing's own OpenSearch suggestion endpoint.
 *
 * The bundled template pool is static and shared by every install, so a run
 * drawn purely from it is both stale and identical across users. Bing's
 * suggestion API returns what people are actually typing right now, and its
 * results for a seed are *refinements* of that seed — which is exactly the
 * shape a real topic run has ("iphone 17" → "iphone 17 review" → "iphone 17
 * vs 16"). Using it turns a burst of unrelated queries into one coherent
 * session.
 *
 * Network I/O is injected (`fetchImpl`) so every function here is testable.
 * Every failure path falls back to the seed alone — the caller must never end
 * up with nothing to search.
 */

import {withTimeout} from '/js/async-utils.js';

export const BING_SUGGEST_ENDPOINT = 'https://api.bing.com/osjson.aspx';
const GOOGLE_TRENDS_RSS_ENDPOINT = 'https://trends.google.com/trending/rss';
const WIKIMEDIA_TOP_ENDPOINT =
    'https://wikimedia.org/api/rest_v1/metrics/pageviews/top';
const SUGGEST_TIMEOUT_MS = 1800;
const TOPIC_SOURCE_TIMEOUT_MS = 2500;
export const MAX_SUGGESTION_LENGTH = 70;
const MAX_DYNAMIC_TOPIC_LENGTH = 120;
export const DYNAMIC_TOPIC_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** @typedef {function(string, !RequestInit): !Promise<?Response>} QueryFetch */
/**
 * @typedef {{fetchImpl: (undefined|null|QueryFetch), timeoutMs:
 * (undefined|number), responseType: (undefined|string), market:
 * (undefined|string), regionCode: (undefined|string), languageCode:
 * (undefined|string), date: (undefined|null|Date|string|number), limit:
 * (undefined|number)}} TopicOptions
 */
/**
 * @typedef {{languageCode: (undefined|string), regionCode: (undefined|string)}}
 * TopicLocale
 */
/**
 * @typedef {{savedAt: number, languageCode: string, regionCode: string,
 *     topics: !Array<string>}} TopicCache
 */
/**
 * @typedef {{rng: (undefined|function(): number), minSize: (undefined|number),
 *     maxSize: (undefined|number), exclude: (undefined|null|Set<string>)}}
 * BurstOptions
 */

const WIKIPEDIA_UTILITY_TOPIC =
    /^(?:main page|special:|wikipedia:|portal:|file:|category:|trang chính|đặc biệt:|cổng thông tin:|tập tin:|thể loại:|página principal|especial:|archivo:|categoría:|accueil|spécial:|fichier:|catégorie:|hauptseite|spezial:|datei:|kategorie:|pagina principale|speciale:|categoria:|portale:|главная страница|служебная:|メインページ|特別:|대문|특수:|首页|特殊:)/iu;

/**
 * @param {?string} query Search text.
 * @param {!TopicOptions=} options Optional market code.
 * @return {string} Encoded suggestion request URL.
 */
export function buildSuggestUrl(query, options = {}) {
  const {market = ''} = options;
  const url = new URL(BING_SUGGEST_ENDPOINT);
  url.searchParams.set('query', String(query ?? ''));
  if (market) {
    url.searchParams.set('mkt', market);
  }
  return url.toString();
}

/**
 * The endpoint answers with the OpenSearch array form:
 *   ["seed", ["suggestion one", "suggestion two", ...]]
 * Anything else (an error object, a bare string, a truncated body) yields [].
 * @param {*} payload Untrusted response body.
 * @return {!Array<string>} Nonempty string entries in response order.
 */
export function parseSuggestResponse(payload) {
  if (!Array.isArray(payload) || payload.length < 2) {
    return [];
  }
  const suggestions = payload[1];
  if (!Array.isArray(suggestions)) {
    return [];
  }
  return suggestions.filter((item) => typeof item === 'string')
      .map((item) => item.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
}

/**
 * Drops empty/overlong suggestions and case-insensitive duplicates.
 * @param {?string} seed Original query to exclude.
 * @param {(Array<string>|null|undefined)} suggestions Candidate refinements.
 * @return {!Array<string>} Usable, unique suggestions in response order.
 */
export function normalizeSuggestions(seed, suggestions) {
  const seen = new Set([
    String(seed ?? '').trim().toLowerCase(),
  ]);
  const result = [];
  for (const suggestion of suggestions || []) {
    const text = String(suggestion ?? '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > MAX_SUGGESTION_LENGTH) {
      continue;
    }
    const key = text.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(text);
  }
  return result;
}

/**
 * @param {*} topics Untrusted cached or remote topic array.
 * @param {{limit: (undefined|number)}=} options Maximum returned topic count.
 * @return {!Array<string>} Normalized strings with utility pages removed.
 */
export function normalizeTopicList(topics, options = {}) {
  const {limit = 80} = options;
  const maxTopics =
      Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 80;
  if (!Array.isArray(topics) || maxTopics === 0) {
    return [];
  }
  const seen = new Set();
  const result = [];
  for (const topic of topics) {
    if (typeof topic !== 'string') {
      continue;
    }
    const text = topic.replace(/_/g, ' ')
                     .replace(/<[^>]*>/g, ' ')
                     .replace(/\s+/g, ' ')
                     .trim();
    if (text.length < 3 || text.length > MAX_DYNAMIC_TOPIC_LENGTH ||
        WIKIPEDIA_UTILITY_TOPIC.test(text)) {
      continue;
    }
    const key = text.toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(text);
    if (result.length >= maxTopics) {
      break;
    }
  }
  return result;
}

/**
 * @param {string} value RSS title content.
 * @return {string} Text with CDATA wrappers and recognized entities decoded.
 */
function decodeXmlEntities(value) {
  const named = {
    amp: '&',
    apos: '\'',
    gt: '>',
    lt: '<',
    quot: '"',
  };
  return String(value ?? '')
      .replace(/^<!\[CDATA\[|\]\]>$/g, '')
      .replace(/&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|quot);/gi, (match, code) => {
        if (code[0] !== '#') {
          return named[code.toLowerCase()] || match;
        }
        const radix = code[1]?.toLowerCase() === 'x' ? 16 : 10;
        const raw = radix === 16 ? code.slice(2) : code.slice(1);
        const point = Number.parseInt(raw, radix);
        return Number.isFinite(point) && point >= 0 && point <= 0x10ffff ?
            String.fromCodePoint(point) :
            match;
      });
}

/**
 * @param {?string} xml RSS body, or null after a failed request.
 * @return {!Array<string>} Valid, unique item titles.
 */
export function parseGoogleTrendsRss(xml) {
  const text = String(xml ?? '');
  const topics = [];
  for (const item of text.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const title = item[1].match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    if (title) {
      topics.push(decodeXmlEntities(title));
    }
  }
  return normalizeTopicList(topics);
}

/**
 * @param {string=} regionCode Requested two-letter region.
 * @return {string} Feed URL with a validated region or US fallback.
 */
export function buildGoogleTrendsUrl(regionCode = 'US') {
  const region = /^[a-z]{2}$/i.test(String(regionCode || '').trim()) ?
      String(regionCode).trim().toUpperCase() :
      'US';
  const url = new URL(GOOGLE_TRENDS_RSS_ENDPOINT);
  url.searchParams.set('geo', region);
  return url.toString();
}

/**
 * @param {string=} languageCode Requested Wikipedia language.
 * @param {(Date|string|number|null)=} date UTC day, or null for yesterday.
 * @return {string} Pageview endpoint with validated language and date.
 */
export function buildWikipediaTopUrl(languageCode = 'en', date = null) {
  const language = /^[a-z]{2,3}(?:-[a-z0-9]+)?$/i.test(
                       String(languageCode || '').trim(),
                       ) ?
      String(languageCode).trim().toLowerCase() :
      'en';
  const supplied = date === null ? NaN : new Date(date).getTime();
  const target =
      new Date(Number.isFinite(supplied) ? supplied : Date.now() - 86400000);
  const yyyy = target.getUTCFullYear();
  const mm = String(target.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(target.getUTCDate()).padStart(2, '0');
  return `${WIKIMEDIA_TOP_ENDPOINT}/${
      encodeURIComponent(language)}.wikipedia/all-access/${yyyy}/${mm}/${dd}`;
}

/**
 * Bounds both response headers and body consumption. Promise.race observes
 * failures after the deadline even if the fetch implementation ignores abort.
 * @param {string} url Endpoint to read without cookies or cache.
 * @param {!TopicOptions=} options Transport, response format and timeout.
 * @return {!Promise<*>} Parsed body, or null on HTTP/read/timeout failure.
 */
async function fetchWithTimeout(url, options = {}) {
  const {
    fetchImpl = typeof fetch === 'function' ? fetch : null,
    timeoutMs = TOPIC_SOURCE_TIMEOUT_MS,
    responseType = 'json',
  } = options;
  if (typeof fetchImpl !== 'function') {
    return null;
  }

  const controller =
      typeof AbortController === 'function' ? new AbortController() : null;
  const deadline = Number.isFinite(timeoutMs) && timeoutMs >= 0 ?
      timeoutMs :
      TOPIC_SOURCE_TIMEOUT_MS;
  try {
    return await withTimeout(async () => {
      const response = await fetchImpl(url, {
        cache: 'no-store',
        credentials: 'omit',
        signal: controller?.signal,
      });
      if (!response?.ok) {
        return null;
      }
      return responseType === 'text' ? response.text() : response.json();
    }, deadline, 'Topic source timed out');
  } catch {
    return null;
  } finally {
    controller?.abort();
  }
}

/**
 * @param {!TopicOptions=} options Region and transport settings.
 * @return {!Promise<!Array<string>>} Feed topics, or an empty fallback.
 */
export async function fetchGoogleTrends(options = {}) {
  const payload = await fetchWithTimeout(
      buildGoogleTrendsUrl(options.regionCode),
      {
        ...options,
        responseType: 'text',
      },
  );
  return parseGoogleTrendsRss(payload);
}

/**
 * @param {!TopicOptions=} options Language, date, limit and transport settings.
 * @return {!Promise<!Array<string>>} Popular page titles, or an empty fallback.
 */
export async function fetchWikipediaTrending(options = {}) {
  const payload = await fetchWithTimeout(
      buildWikipediaTopUrl(options.languageCode, options.date),
      options,
  );
  const articles = payload?.items?.[0]?.articles;
  if (!Array.isArray(articles)) {
    return [];
  }
  return normalizeTopicList(
      articles.map((article) => article?.article),
      {limit: options.limit ?? 50},
  );
}

/**
 * Alternates normalized sources and deduplicates across lists. Indexed reads
 * avoid copying and repeatedly shifting the source arrays.
 * @param {!Array<!Array<string>>} lists Source topic lists.
 * @param {number} limit Maximum combined count.
 * @return {!Array<string>} Alternating unique topics in source order.
 */
function interleaveTopicLists(lists, limit) {
  const output = [];
  const seen = new Set();
  const rowCount = Math.max(0, ...lists.map((list) => list.length));
  for (let index = 0; index < rowCount && output.length < limit; index++) {
    for (const list of lists) {
      if (index < list.length) {
        const topic = list[index];
        const key = topic.toLocaleLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          output.push(topic);
        }
      }
      if (output.length >= limit) {
        break;
      }
    }
  }
  return output;
}

/**
 * @param {!TopicOptions=} options Locale, limit and transport settings.
 * @return {!Promise<!Array<string>>} Merged topics from available sources.
 */
export async function fetchDynamicTopics(options = {}) {
  const limit = Math.max(1, Number(options.limit) || 60);
  const [google, wikipedia] = await Promise.all([
    fetchGoogleTrends(options),
    fetchWikipediaTrending(options),
  ]);
  return interleaveTopicLists([google, wikipedia], limit);
}

/**
 * @param {!Array<string>} topics Topics to store.
 * @param {number=} now Save time in epoch milliseconds.
 * @param {!TopicLocale=} locale Locale used to load these topics.
 * @return {!TopicCache} Normalized cache record.
 */
export function createDynamicTopicCache(topics, now = Date.now(), locale = {}) {
  return {
    savedAt: Number.isFinite(now) ? now : Date.now(),
    languageCode: String(locale.languageCode || '').toLowerCase(),
    regionCode: String(locale.regionCode || '').toUpperCase(),
    topics: normalizeTopicList(topics),
  };
}

/**
 * @param {*} value Untrusted storage record.
 * @param {number=} now Current epoch milliseconds.
 * @param {number=} ttlMs Maximum accepted age in milliseconds.
 * @param {!TopicLocale=} locale Required locale; omitted fields do not restrict
 *     it.
 * @return {!Array<string>} Fresh matching topics, or an empty fallback.
 */
export function readFreshDynamicTopicCache(
    value,
    now = Date.now(),
    ttlMs = DYNAMIC_TOPIC_CACHE_TTL_MS,
    locale = {},
) {
  const savedAt = value?.savedAt;
  const expectedLanguage = String(locale.languageCode || '').toLowerCase();
  const expectedRegion = String(locale.regionCode || '').toUpperCase();
  const cachedLanguage = String(value?.languageCode || '').toLowerCase();
  const cachedRegion = String(value?.regionCode || '').toUpperCase();
  if (!Number.isFinite(savedAt) || !Number.isFinite(now) ||
      !Number.isFinite(ttlMs) || ttlMs < 0 || now - savedAt < 0 ||
      now - savedAt > ttlMs ||
      (expectedLanguage && cachedLanguage !== expectedLanguage) ||
      (expectedRegion && cachedRegion !== expectedRegion)) {
    return [];
  }
  return normalizeTopicList(value?.topics);
}

/**
 * Build the queries for one topic run: the seed, then its refinements in the
 * order Bing returned them.
 *
 * Order is deliberately preserved rather than shuffled — Bing ranks
 * suggestions by popularity, and typing progressively less common refinements
 * of a topic is what a person narrowing a search actually does.
 *
 * `exclude` is a Set of lowercased queries already searched this run. A seed
 * can legitimately come round twice (the trending pool is small and its used
 * set is cleared once exhausted), and its suggestions are then near-identical
 * to last time — without this filter the run visibly repeats itself.
 * @param {?string} seed Original query.
 * @param {(Array<string>|null|undefined)} suggestions Candidate refinements.
 * @param {!BurstOptions=} options Random source, size bounds and used queries.
 * @return {!Array<string>} Seed and unused refinements in response order.
 */
export function buildQueryBurst(seed, suggestions, options = {}) {
  const {
    rng = Math.random,
    minSize = 3,
    maxSize = 6,
    exclude = null,
  } = options;
  const base = String(seed ?? '').replace(/\s+/g, ' ').trim();
  if (!base) {
    return [];
  }

  /**
   * @param {string} text Query to check.
   * @return {boolean} Whether the caller has already used this query.
   */
  const isUsed = (text) =>
      Boolean(exclude) && exclude.has(String(text).toLowerCase());

  const clean = normalizeSuggestions(base, suggestions)
                    .filter(
                        (text) => !isUsed(text),
                    );
  const target =
      minSize + Math.floor(rng() * Math.max(1, maxSize - minSize + 1));
  const refinements = clean.slice(0, Math.max(0, target - 1));
  // A repeated seed is dropped, but its unused refinements are still good
  // queries — returning them keeps a partially-fresh topic usable instead of
  // forcing the caller to roll another seed.
  return isUsed(base) ? refinements : [base, ...refinements];
}

/**
 * Fetch suggestions for `query`. Resolves to [] on any failure (offline,
 * non-2xx, malformed body, timeout) — the caller falls back to the local pool,
 * so a dead endpoint degrades the run's realism but never breaks it.
 * @param {?string} query Original query.
 * @param {!TopicOptions=} options Market and transport settings.
 * @return {!Promise<!Array<string>>} Normalized suggestions or an empty
 *     fallback.
 */
export async function fetchSuggestions(query, options = {}) {
  const text = String(query ?? '').trim();
  if (!text) {
    return [];
  }
  const payload = await fetchWithTimeout(buildSuggestUrl(text, options), {
    ...options,
    timeoutMs: options.timeoutMs ?? SUGGEST_TIMEOUT_MS,
    responseType: 'json',
  });
  return normalizeSuggestions(text, parseSuggestResponse(payload));
}

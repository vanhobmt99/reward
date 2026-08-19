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

export const BING_SUGGEST_ENDPOINT = "https://api.bing.com/osjson.aspx";
const GOOGLE_TRENDS_RSS_ENDPOINT = "https://trends.google.com/trending/rss";
const WIKIMEDIA_TOP_ENDPOINT =
  "https://wikimedia.org/api/rest_v1/metrics/pageviews/top";
const SUGGEST_TIMEOUT_MS = 1800;
const TOPIC_SOURCE_TIMEOUT_MS = 2500;
export const MAX_SUGGESTION_LENGTH = 70;
const MAX_DYNAMIC_TOPIC_LENGTH = 120;
export const DYNAMIC_TOPIC_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const WIKIPEDIA_UTILITY_TOPIC =
  /^(?:main page|special:|wikipedia:|portal:|file:|category:|trang chính|đặc biệt:|cổng thông tin:|tập tin:|thể loại:|página principal|especial:|archivo:|categoría:|accueil|spécial:|fichier:|catégorie:|hauptseite|spezial:|datei:|kategorie:|pagina principale|speciale:|categoria:|portale:|главная страница|служебная:|メインページ|特別:|대문|특수:|首页|特殊:)/iu;

export function buildSuggestUrl(query, options = {}) {
  const { market = "" } = options;
  const url = new URL(BING_SUGGEST_ENDPOINT);
  url.searchParams.set("query", String(query ?? ""));
  if (market) url.searchParams.set("mkt", market);
  return url.toString();
}

/**
 * The endpoint answers with the OpenSearch array form:
 *   ["seed", ["suggestion one", "suggestion two", ...]]
 * Anything else (an error object, a bare string, a truncated body) yields [].
 */
export function parseSuggestResponse(payload) {
  if (!Array.isArray(payload) || payload.length < 2) return [];
  const suggestions = payload[1];
  if (!Array.isArray(suggestions)) return [];
  return suggestions
    .filter((item) => typeof item === "string")
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

// Drop suggestions that are unusable as a search: empty, absurdly long
// (usually a pasted sentence), or a case-insensitive duplicate of the seed or
// of an earlier pick.
export function normalizeSuggestions(seed, suggestions) {
  const seen = new Set([
    String(seed ?? "")
      .trim()
      .toLowerCase(),
  ]);
  const result = [];
  for (const suggestion of suggestions || []) {
    const text = String(suggestion ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text || text.length > MAX_SUGGESTION_LENGTH) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

export function normalizeTopicList(topics, options = {}) {
  const { limit = 80 } = options;
  const seen = new Set();
  const result = [];
  for (const topic of topics || []) {
    const text = String(topic ?? "")
      .replace(/_/g, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (
      text.length < 3 ||
      text.length > MAX_DYNAMIC_TOPIC_LENGTH ||
      WIKIPEDIA_UTILITY_TOPIC.test(text)
    ) {
      continue;
    }
    const key = text.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

function decodeXmlEntities(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: '"',
  };
  return String(value ?? "")
    .replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|quot);/gi, (match, code) => {
      if (code[0] !== "#") return named[code.toLowerCase()] || match;
      const radix = code[1]?.toLowerCase() === "x" ? 16 : 10;
      const raw = radix === 16 ? code.slice(2) : code.slice(1);
      const point = Number.parseInt(raw, radix);
      return Number.isFinite(point) && point >= 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : match;
    });
}

export function parseGoogleTrendsRss(xml) {
  const text = String(xml ?? "");
  const topics = [];
  for (const item of text.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const title = item[1].match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    if (title) topics.push(decodeXmlEntities(title));
  }
  return normalizeTopicList(topics);
}

export function buildGoogleTrendsUrl(regionCode = "US") {
  const region = /^[a-z]{2}$/i.test(String(regionCode || "").trim())
    ? String(regionCode).toUpperCase()
    : "US";
  const url = new URL(GOOGLE_TRENDS_RSS_ENDPOINT);
  url.searchParams.set("geo", region);
  return url.toString();
}

export function buildWikipediaTopUrl(languageCode = "en", date = null) {
  const language = /^[a-z]{2,3}(?:-[a-z0-9]+)?$/i.test(
    String(languageCode || "").trim(),
  )
    ? String(languageCode).toLowerCase()
    : "en";
  const target = date ? new Date(date) : new Date(Date.now() - 86400000);
  const yyyy = target.getUTCFullYear();
  const mm = String(target.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(target.getUTCDate()).padStart(2, "0");
  return `${WIKIMEDIA_TOP_ENDPOINT}/${encodeURIComponent(language)}.wikipedia/all-access/${yyyy}/${mm}/${dd}`;
}

async function fetchWithTimeout(url, options = {}) {
  const {
    fetchImpl = typeof fetch === "function" ? fetch : null,
    timeoutMs = TOPIC_SOURCE_TIMEOUT_MS,
    responseType = "json",
  } = options;
  if (typeof fetchImpl !== "function") return null;

  const controller =
    typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;
  try {
    const response = await fetchImpl(url, {
      cache: "no-store",
      credentials: "omit",
      signal: controller ? controller.signal : undefined,
    });
    if (!response?.ok) return null;
    return responseType === "text"
      ? await response.text()
      : await response.json();
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function fetchGoogleTrends(options = {}) {
  const payload = await fetchWithTimeout(
    buildGoogleTrendsUrl(options.regionCode),
    {
      ...options,
      responseType: "text",
    },
  );
  return parseGoogleTrendsRss(payload);
}

export async function fetchWikipediaTrending(options = {}) {
  const payload = await fetchWithTimeout(
    buildWikipediaTopUrl(options.languageCode, options.date),
    options,
  );
  const articles = payload?.items?.[0]?.articles;
  if (!Array.isArray(articles)) return [];
  return normalizeTopicList(
    articles.map((article) => article?.article),
    { limit: options.limit || 50 },
  );
}

// Round-robin the sources so one of them going quiet cannot dominate the pool.
// Each input list has already been through normalizeTopicList, so the only work
// left here is cross-list de-duplication (the same story trends on Google and
// Wikipedia at once) — re-normalizing every entry would be wasted work.
function interleaveTopicLists(lists, limit) {
  const output = [];
  const seen = new Set();
  const rows = lists.map((list) => [...list]);
  while (rows.some((row) => row.length > 0) && output.length < limit) {
    for (const row of rows) {
      if (row.length > 0) {
        const topic = row.shift();
        const key = topic.toLocaleLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          output.push(topic);
        }
      }
      if (output.length >= limit) break;
    }
  }
  return output;
}

export async function fetchDynamicTopics(options = {}) {
  const limit = Math.max(1, Number(options.limit) || 60);
  const [google, wikipedia] = await Promise.all([
    fetchGoogleTrends(options),
    fetchWikipediaTrending(options),
  ]);
  return interleaveTopicLists([google, wikipedia], limit);
}

export function createDynamicTopicCache(topics, now = Date.now(), locale = {}) {
  return {
    savedAt: Number(now) || Date.now(),
    languageCode: String(locale.languageCode || "").toLowerCase(),
    regionCode: String(locale.regionCode || "").toUpperCase(),
    topics: normalizeTopicList(topics),
  };
}

export function readFreshDynamicTopicCache(
  value,
  now = Date.now(),
  ttlMs = DYNAMIC_TOPIC_CACHE_TTL_MS,
  locale = {},
) {
  const savedAt = Number(value?.savedAt);
  const expectedLanguage = String(locale.languageCode || "").toLowerCase();
  const expectedRegion = String(locale.regionCode || "").toUpperCase();
  const cachedLanguage = String(value?.languageCode || "").toLowerCase();
  const cachedRegion = String(value?.regionCode || "").toUpperCase();
  if (
    !Number.isFinite(savedAt) ||
    Number(now) - savedAt < 0 ||
    Number(now) - savedAt > ttlMs ||
    (expectedLanguage && cachedLanguage !== expectedLanguage) ||
    (expectedRegion && cachedRegion !== expectedRegion)
  ) {
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
 */
export function buildQueryBurst(seed, suggestions, options = {}) {
  const {
    rng = Math.random,
    minSize = 3,
    maxSize = 6,
    exclude = null,
  } = options;
  const base = String(seed ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!base) return [];

  const isUsed = (text) =>
    Boolean(exclude) && exclude.has(String(text).toLowerCase());

  const clean = normalizeSuggestions(base, suggestions).filter(
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
 * Fetch suggestions for `query`. Resolves to [] on any failure (offline, non-2xx,
 * malformed body, timeout) — the caller falls back to the local pool, so a dead
 * endpoint degrades the run's realism but never breaks it.
 */
export async function fetchSuggestions(query, options = {}) {
  const {
    fetchImpl = typeof fetch === "function" ? fetch : null,
    market = "",
    timeoutMs = SUGGEST_TIMEOUT_MS,
  } = options;

  const text = String(query ?? "").trim();
  if (!text || typeof fetchImpl !== "function") return [];

  // AbortController may be absent in some test harnesses; without it the fetch
  // simply has no timeout rather than throwing.
  const controller =
    typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    const response = await fetchImpl(buildSuggestUrl(text, { market }), {
      cache: "no-store",
      // The suggestion endpoint needs no Rewards cookies, and sending them on a
      // third-party-ish request buys nothing.
      credentials: "omit",
      signal: controller ? controller.signal : undefined,
    });
    if (!response || !response.ok) return [];
    const payload = await response.json();
    return normalizeSuggestions(text, parseSuggestResponse(payload));
  } catch {
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

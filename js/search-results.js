/**
 * Normalizes whitespace and case before URL-query comparison.
 * @param {(string|null|undefined)} value Raw query text.
 * @return {string} Comparable query.
 */
function normalizeQuery(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

/**
 * Checks the host, search path and optional expected query.
 * @param {(string|null|undefined)} url Candidate navigation URL.
 * @param {string=} expectedQuery Expected query, or empty to accept any query.
 * @return {boolean} Whether navigation matches the expected search.
 */
export function isConfirmedBingSearchUrl(url, expectedQuery = '') {
  try {
    const parsed = new URL(String(url || ''));
    const host = parsed.hostname.toLowerCase();
    if (host !== 'bing.com' && !host.endsWith('.bing.com')) {
      return false;
    }
    if (!/^\/search\/?$/i.test(parsed.pathname)) {
      return false;
    }

    const actual = normalizeQuery(parsed.searchParams.get('q'));
    if (!actual) {
      return false;
    }
    const expected = normalizeQuery(expectedQuery);
    return !expected || actual === expected;
  } catch {
    return false;
  }
}

/**
 * Checks equality against a positive integer requested count.
 * @param {(number|string)} successful Completed navigations.
 * @param {(number|string)} requested Requested navigations.
 * @return {boolean} Whether every requested navigation completed.
 */
export function isCompleteSearchCount(successful, requested) {
  const expected = Math.max(0, Math.floor(Number(requested) || 0));
  const actual = Math.max(0, Math.floor(Number(successful) || 0));
  return expected > 0 && actual === expected;
}

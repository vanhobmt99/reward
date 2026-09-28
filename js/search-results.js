function normalizeQuery(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

export function isConfirmedBingSearchUrl(url, expectedQuery = "") {
  try {
    const parsed = new URL(String(url || ""));
    const host = parsed.hostname.toLowerCase();
    if (host !== "bing.com" && !host.endsWith(".bing.com")) return false;
    if (!/^\/search\/?$/i.test(parsed.pathname)) return false;

    const actual = normalizeQuery(parsed.searchParams.get("q"));
    if (!actual) return false;
    const expected = normalizeQuery(expectedQuery);
    return !expected || actual === expected;
  } catch {
    return false;
  }
}

export function isCompleteSearchCount(successful, requested) {
  const expected = Math.max(0, Math.floor(Number(requested) || 0));
  const actual = Math.max(0, Math.floor(Number(successful) || 0));
  return expected > 0 && actual === expected;
}

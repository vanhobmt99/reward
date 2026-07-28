/**
 * Auth-cookie backup/restore used by the mobile-points flow: before clearing
 * Bing cookies we snapshot the Rewards/Bing login cookies, then restore any that
 * the clear removed so Daily set / Keep earning still work. Extracted from
 * service.js as a factory so the chrome.cookies API and logger are injected
 * (keeps it unit-testable without a browser).
 */

export const CLEARED_COOKIE_DOMAINS = ["bing.com", "rewards.bing.com"];

// Reconstruct a cookie URL from a stored cookie record. Pure.
export function cookieUrlFromStored(cookie) {
  if (cookie.url) return cookie.url;
  const host = cookie.domain?.startsWith(".")
    ? cookie.domain.slice(1)
    : cookie.domain;
  const protocol = cookie.secure ? "https" : "http";
  return `${protocol}://${host}${cookie.path || "/"}`;
}

// Auth/session cookies must be written AFTER their prerequisite cookies.
const AUTH_COOKIE_PATTERNS =
  /\b(auth|token|session|wls|muid|rpssec|cred|signin|login|ppauth|kaka)\b/i;

export function createCookieHelpers({
  cookies,
  log = () => {},
  logEnabled = () => false,
} = {}) {
  const say = (message, level) => {
    if (logEnabled()) log(message, level);
  };

  async function backupAuthCookiesDetailed() {
    const seen = new Set();
    const snapshot = [];
    const failedDomains = [];
    for (const domain of CLEARED_COOKIE_DOMAINS) {
      let list = [];
      try {
        list = await cookies.getAll({ domain });
      } catch (error) {
        failedDomains.push(domain);
        say(
          `[COOKIES] Could not read cookies for ${domain}: ${error.message}`,
          "warning",
        );
        continue;
      }
      for (const cookie of list) {
        const key = `${cookie.storeId || ""}|${cookie.domain}|${cookie.path}|${cookie.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        snapshot.push({
          url: cookieUrlFromStored(cookie),
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          hostOnly: cookie.hostOnly,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite,
          expirationDate: cookie.expirationDate,
          storeId: cookie.storeId,
        });
      }
    }
    say(
      `[COOKIES] Backed up ${snapshot.length} auth cookies before mobile clear.`,
      "update",
    );
    return {
      cookies: snapshot,
      complete: failedDomains.length === 0,
      failedDomains,
    };
  }

  async function backupAuthCookies() {
    const result = await backupAuthCookiesDetailed();
    return result.cookies;
  }

  async function hasCurrentCookie(cookie) {
    try {
      const details = {
        url: cookieUrlFromStored(cookie),
        name: cookie.name,
      };
      if (cookie.storeId) details.storeId = cookie.storeId;
      return Boolean(await cookies.get(details));
    } catch (error) {
      say(
        `[COOKIES] Could not check current cookie ${cookie.name}: ${error.message}`,
        "warning",
      );
      return false;
    }
  }

  async function restoreAuthCookiesDetailed(snapshot) {
    if (!Array.isArray(snapshot) || snapshot.length === 0) {
      say(`[COOKIES] No auth cookies to restore.`, "warning");
      return { restored: 0, skipped: 0, failed: 0, complete: true };
    }

    const sorted = [...snapshot].sort((a, b) => {
      const aAuth = AUTH_COOKIE_PATTERNS.test(a.name);
      const bAuth = AUTH_COOKIE_PATTERNS.test(b.name);
      if (aAuth && !bAuth) return 1;
      if (!aAuth && bAuth) return -1;
      return 0;
    });

    let restored = 0;
    let skipped = 0;
    let failed = 0;
    for (const cookie of sorted) {
      try {
        if (await hasCurrentCookie(cookie)) {
          skipped++;
          continue;
        }
        const details = {
          url: cookieUrlFromStored(cookie),
          name: cookie.name,
          value: cookie.value,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite,
        };
        // `__Host-` cookies MUST be set without a domain (and host-only cookies
        // lose their host-only scope if a domain is supplied), so only pass
        // domain for genuine domain-scoped cookies. Passing domain for a
        // `__Host-` cookie makes chrome.cookies.set reject it outright.
        const isHostPrefixed = /^__Host-/i.test(cookie.name);
        if (cookie.domain && !cookie.hostOnly && !isHostPrefixed) {
          details.domain = cookie.domain;
        }
        if (cookie.expirationDate)
          details.expirationDate = cookie.expirationDate;
        if (cookie.storeId) details.storeId = cookie.storeId;
        await cookies.set(details);
        restored++;
      } catch (error) {
        failed++;
        say(
          `[COOKIES] Failed to restore ${cookie.name}: ${error.message}`,
          "warning",
        );
      }
    }
    say(
      `[COOKIES] Restored ${restored}/${snapshot.length} auth cookies after mobile searches (${skipped} already present).`,
      restored > 0 ? "success" : "warning",
    );
    return {
      restored,
      skipped,
      failed,
      complete: failed === 0 && restored + skipped === snapshot.length,
    };
  }

  async function restoreAuthCookies(snapshot) {
    const result = await restoreAuthCookiesDetailed(snapshot);
    return result.restored;
  }

  return {
    backupAuthCookies,
    backupAuthCookiesDetailed,
    hasCurrentCookie,
    restoreAuthCookies,
    restoreAuthCookiesDetailed,
  };
}

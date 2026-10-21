/**
 * Auth-cookie backup/restore used by the mobile-points flow: before clearing
 * Bing cookies we snapshot the Rewards/Bing login cookies, then restore any
 * that the clear removed so Daily set / Keep earning still work. Extracted from
 * service.js as a factory so the chrome.cookies API and logger are injected
 * (keeps it unit-testable without a browser).
 */

export const CLEARED_COOKIE_DOMAINS = ['bing.com', 'rewards.bing.com'];

/**
 * @typedef {{url: (string|undefined), name: string, value: (string|undefined),
 *     domain: (string|undefined), hostOnly: (boolean|undefined),
 *     path: (string|undefined), secure: (boolean|undefined),
 *     httpOnly: (boolean|undefined), sameSite: (string|undefined),
 *     expirationDate: (number|undefined), storeId: (string|undefined)}}
 *     StoredAuthCookie
 */
/**
 * @typedef {{getAll: function({domain: string}):
 * !Promise<!Array<!StoredAuthCookie>>, get: function({url: string, name:
 * string, storeId: (string|undefined)}): !Promise<?StoredAuthCookie>, set:
 * function(!StoredAuthCookie): !Promise<?StoredAuthCookie>}} AuthCookieApi
 */
/**
 * @typedef {{cookies: !AuthCookieApi,
 *     log: (undefined|function(string, string): void),
 *     logEnabled: (undefined|function(): boolean)}} CookieHelperDeps
 */
/**
 * @typedef {{cookies: !Array<!StoredAuthCookie>, complete: boolean,
 *     failedDomains: !Array<string>}} AuthCookieBackup
 */
/**
 * @typedef {{restored: number, skipped: number, failed: number,
 *     complete: boolean}} AuthCookieRestore
 */
/**
 * @typedef {{backupAuthCookies: function():
 * !Promise<!Array<!StoredAuthCookie>>, backupAuthCookiesDetailed: function():
 * !Promise<!AuthCookieBackup>, hasCurrentCookie: function(!StoredAuthCookie):
 * !Promise<boolean>, restoreAuthCookies: function(!Array<!StoredAuthCookie>):
 * !Promise<number>, restoreAuthCookiesDetailed:
 * function(!Array<!StoredAuthCookie>|null|undefined):
 * !Promise<!AuthCookieRestore>}} CookieHelpers
 */

/**
 * Reconstructs a cookie URL from a stored cookie record.
 * @param {!StoredAuthCookie} cookie Snapshot or live cookie. An existing url
 *     is kept.
 * @return {string} URL accepted by cookies.get and cookies.set.
 */
function cookieUrlFromStored(cookie) {
  if (cookie.url) {
    return cookie.url;
  }
  const host =
      cookie.domain?.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
  const protocol = cookie.secure ? 'https' : 'http';
  return `${protocol}://${host}${cookie.path || '/'}`;
}

// Auth/session cookies must be written AFTER their prerequisite cookies.
const AUTH_COOKIE_PATTERNS =
    /\b(auth|token|session|wls|muid|rpssec|cred|signin|login|ppauth|kaka)\b/i;

/**
 * Builds backup and restore helpers around an injected cookies API.
 * @param {!CookieHelperDeps=} deps Cookies API and optional logger. log
 *     defaults to a no-op and logEnabled to false.
 * @return {!CookieHelpers} Backup, presence check and restore operations.
 */
export function createCookieHelpers({
  cookies,
  log = () => {},
  logEnabled = () => false,
} = {}) {
  /**
   * @param {string} message Log line.
   * @param {string} level Logger level, such as "warning" or "update".
   */
  const say = (message, level) => {
    if (logEnabled()) {
      log(message, level);
    }
  };

  /**
   * Reads Rewards and Bing cookies for the domains that mobile clear removes.
   * @return {!Promise<!AuthCookieBackup>} Snapshot plus domains that could not
   *     be read.
   */
  async function backupAuthCookiesDetailed() {
    const seen = new Set();
    const snapshot = [];
    const failedDomains = [];
    for (const domain of CLEARED_COOKIE_DOMAINS) {
      let list = [];
      try {
        list = await cookies.getAll({domain});
      } catch (error) {
        failedDomains.push(domain);
        say(
            `[COOKIES] Could not read cookies for ${domain}: ${error.message}`,
            'warning',
        );
        continue;
      }
      for (const cookie of list) {
        const key = `${cookie.storeId || ''}|${cookie.domain}|${cookie.path}|${
            cookie.name}`;
        if (seen.has(key)) {
          continue;
        }
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
        `[COOKIES] Backed up ${
            snapshot.length} auth cookies before mobile clear.`,
        'update',
    );
    return {
      cookies: snapshot,
      complete: failedDomains.length === 0,
      failedDomains,
    };
  }

  /**
   * @return {!Promise<!Array<!StoredAuthCookie>>} Cookie snapshot. Failed
   *     domains are omitted.
   */
  async function backupAuthCookies() {
    const result = await backupAuthCookiesDetailed();
    return result.cookies;
  }

  /**
   * @param {!StoredAuthCookie} cookie Snapshot entry to look up.
   * @return {!Promise<boolean>} False when the cookie is absent or the read
   *     fails.
   */
  async function hasCurrentCookie(cookie) {
    try {
      const details = {
        url: cookieUrlFromStored(cookie),
        name: cookie.name,
      };
      if (cookie.storeId) {
        details.storeId = cookie.storeId;
      }
      return Boolean(await cookies.get(details));
    } catch (error) {
      say(
          `[COOKIES] Could not check current cookie ${cookie.name}: ${
              error.message}`,
          'warning',
      );
      return false;
    }
  }

  /**
   * Writes missing cookies, auth cookies last. A non-array snapshot is a no-op
   * success.
   * @param {!Array<!StoredAuthCookie>|null|undefined} snapshot Cookies captured
   *     before the clear.
   * @return {!Promise<!AuthCookieRestore>} Restored, skipped and failed counts.
   */
  async function restoreAuthCookiesDetailed(snapshot) {
    if (!Array.isArray(snapshot) || snapshot.length === 0) {
      say(`[COOKIES] No auth cookies to restore.`, 'warning');
      return {restored: 0, skipped: 0, failed: 0, complete: true};
    }

    const sorted = [...snapshot].sort((a, b) => {
      const aAuth = AUTH_COOKIE_PATTERNS.test(a.name);
      const bAuth = AUTH_COOKIE_PATTERNS.test(b.name);
      if (aAuth && !bAuth) {
        return 1;
      }
      if (!aAuth && bAuth) {
        return -1;
      }
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
        if (cookie.expirationDate) {
          details.expirationDate = cookie.expirationDate;
        }
        if (cookie.storeId) {
          details.storeId = cookie.storeId;
        }
        await cookies.set(details);
        restored++;
      } catch (error) {
        failed++;
        say(
            `[COOKIES] Failed to restore ${cookie.name}: ${error.message}`,
            'warning',
        );
      }
    }
    say(
        `[COOKIES] Restored ${restored}/${
            snapshot.length} auth cookies after mobile searches (${
            skipped} already present).`,
        restored > 0 ? 'success' : 'warning',
    );
    return {
      restored,
      skipped,
      failed,
      complete: failed === 0 && restored + skipped === snapshot.length,
    };
  }

  /**
   * @param {!Array<!StoredAuthCookie>|null|undefined} snapshot Cookies captured
   *     before the clear.
   * @return {!Promise<number>} How many cookies were written.
   */
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

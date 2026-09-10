const DEFAULT_REWARD_HOSTS = [
  "bing.com",
  "microsoft.com",
  "live.com",
  "msn.com",
  "xbox.com",
  "microsoftonline.com",
];

export function isRewardActivityUrl(url, allowedHosts = DEFAULT_REWARD_HOSTS) {
  try {
    const parsed = new URL(String(url || ""));
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const hostname = parsed.hostname.toLowerCase();
    return allowedHosts.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`),
    );
  } catch {
    return false;
  }
}

export function isActivityOpenedTab(
  tab,
  mainTabId,
  existingTabIds,
  allowedHosts = DEFAULT_REWARD_HOSTS,
) {
  if (!tab?.id || Number(tab.id) === Number(mainTabId)) return false;
  if (existingTabIds?.has(tab.id)) return false;

  // If the tab's opener is explicitly another tab, ignore it.
  if (
    tab.openerTabId != null &&
    Number(tab.openerTabId) !== Number(mainTabId)
  ) {
    return false;
  }

  const url = String(tab.url || tab.pendingUrl || "");
  const hasMatchingOpener = Number(tab.openerTabId) === Number(mainTabId);

  // If it has matching opener, accept about:blank or any reward url.
  if (hasMatchingOpener) {
    return url === "about:blank" || isRewardActivityUrl(url, allowedHosts);
  }

  // Modern browsers strip openerTabId for target="_blank" (rel="noopener").
  // For newly created tabs without openerTabId, check if it's a reward activity URL.
  if (tab.openerTabId == null || tab.openerTabId === undefined) {
    return isRewardActivityUrl(url, allowedHosts);
  }

  return false;
}

export { DEFAULT_REWARD_HOSTS };

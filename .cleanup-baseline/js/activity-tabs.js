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

// A tab counts as opened by the activity click when its id was not in the
// snapshot taken immediately before the press and it is not the Rewards tab.
// target=_blank plus rel=noopener drops openerTabId, and the new tab is often
// still about:blank or already on a non-reward host by the time we look.
// Those tabs are still ours to close.
export function isActivityOpenedTab(tab, mainTabId, existingTabIds) {
  if (!tab?.id || Number(tab.id) === Number(mainTabId)) return false;
  if (existingTabIds?.has(tab.id)) return false;
  return true;
}

export function tabsToClose(tabs, mainTabId, existingTabIds) {
  return (tabs || []).filter((tab) =>
    isActivityOpenedTab(tab, mainTabId, existingTabIds),
  );
}

export { DEFAULT_REWARD_HOSTS };

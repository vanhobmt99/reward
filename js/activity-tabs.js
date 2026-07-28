const DEFAULT_REWARD_HOSTS = [
  "bing.com",
  "microsoft.com",
  "live.com",
  "office.com",
  "outlook.com",
  "msn.com",
  "windows.com",
  "azure.com",
  "xbox.com",
  "skype.com",
  "microsoftonline.com",
  "sharepoint.com",
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

  // Only touch tabs that the automation tab actually opened. A URL/domain
  // match alone is unsafe: the user may open Bing/Outlook while activities run.
  if (Number(tab.openerTabId) !== Number(mainTabId)) return false;

  const url = String(tab.url || tab.pendingUrl || "");
  // about:blank is expected briefly for target=_blank; it is checked again
  // after navigation before the tab is processed or closed.
  return url === "about:blank" || isRewardActivityUrl(url, allowedHosts);
}

export { DEFAULT_REWARD_HOSTS };

/**
 * Tab-lifetime helpers shared by wait() and waitForUrl().
 * A closed/discarded automation tab is a normal run interruption, not a crash.
 */

export function isTabGoneError(error) {
  return /(?:no tab with id|tab not found|invalid tab id)/i.test(
    String(error?.message || error || ""),
  );
}

/**
 * Subscribe to tab removal for `tabId`. Returns an unsubscribe function.
 * `tabsApi` is injected (chrome.tabs in production, a fake in tests).
 */
export function listenForTabGone(tabsApi, tabId, onGone) {
  if (!tabsApi?.onRemoved?.addListener || typeof onGone !== "function") {
    return () => {};
  }
  const onRemoved = (removedTabId) => {
    if (removedTabId === tabId) onGone();
  };
  tabsApi.onRemoved.addListener(onRemoved);
  return () => {
    try {
      tabsApi.onRemoved.removeListener(onRemoved);
    } catch {
      // Listener already gone with the API surface.
    }
  };
}

/**
 * @typedef {function(number, !Object, !chrome.tabs.Tab): void}
 * TabUpdateListener
 */
/** @typedef {function(number): void} TabRemovedListener */
/**
 * @template T
 * @typedef {{addListener: function(T): void, removeListener: function(T):
 * void}} ListenerSource
 */
/**
 * @typedef {{get: function(number): !Promise<!chrome.tabs.Tab>,
 *     onUpdated: !ListenerSource<TabUpdateListener>,
 *     onRemoved: !ListenerSource<TabRemovedListener>}} TabWaitApi
 */
/**
 * @typedef {'matched'|'timeout'|'cancelled'|'removed'|'error'} TabWaitReason
 */
/**
 * @typedef {{success: boolean, url: string, reason: TabWaitReason}}
 * TabWaitResult
 */
/**
 * @typedef {{tabs: !TabWaitApi, matches: function(!chrome.tabs.Tab): boolean,
 *     timeoutMs: number, isCancelled: (undefined|function(): boolean)}}
 * TabWaitOptions
 */

/**
 * Waits for an initial tab snapshot or update to match. The timeout never
 * awaits another browser read; even an unresponsive tabs.get cannot extend it.
 * Every terminal path removes listeners and timers. Late reads are observed
 * but cannot override a newer update or a settled result.
 * @param {number} tabId Tab to observe.
 * @param {!TabWaitOptions} options Browser API, predicate and wait bounds.
 * @return {!Promise<!TabWaitResult>} Final outcome and last observed URL.
 */
export function waitForTab(tabId, options) {
  const {tabs, matches, timeoutMs, isCancelled} = options;
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    let cancelTimer;
    let updateAttached = false;
    let removalAttached = false;
    let version = 0;
    let lastUrl = '';

    /** @param {TabWaitReason} reason Terminal outcome. */
    const finish = (reason) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      clearInterval(cancelTimer);
      if (updateAttached) {
        tabs.onUpdated.removeListener(onUpdated);
      }
      if (removalAttached) {
        tabs.onRemoved.removeListener(onRemoved);
      }
      resolve({success: reason === 'matched', url: lastUrl, reason});
    };

    /** @return {boolean} Whether cancellation ended this wait. */
    const checkCancelled = () => {
      if (isCancelled?.()) {
        finish('cancelled');
        return true;
      }
      return false;
    };

    /** @param {!chrome.tabs.Tab} tab Current observed tab snapshot. */
    const inspect = (tab) => {
      if (settled) {
        return;
      }
      try {
        if (checkCancelled()) {
          return;
        }
        if (typeof tab.url === 'string') {
          lastUrl = tab.url;
        }
        if (matches(tab)) {
          finish('matched');
        }
      } catch {
        finish('error');
      }
    };

    /**
     * @return {void} Starts an observed read without holding up the deadline.
     */
    const readCurrent = () => {
      const readVersion = version;
      Promise.resolve()
          .then(() => tabs.get(tabId))
          .then(
              (tab) => {
                if (readVersion === version) {
                  inspect(tab);
                }
              },
              () => {
                if (readVersion === version) {
                  finish('error');
                }
              });
    };

    /**
     * @param {number} updatedId Updated tab ID.
     * @param {!Object} changeInfo Changed tab fields.
     * @param {!chrome.tabs.Tab} tab Tab snapshot attached to the event.
     */
    const onUpdated = (updatedId, changeInfo, tab) => {
      if (updatedId !== tabId || settled) {
        return;
      }
      version++;
      const current = {...tab, ...changeInfo};
      inspect(current);
      if (!settled && changeInfo.status === 'complete' && !current.url) {
        readCurrent();
      }
    };

    /** @param {number} removedId Closed tab ID. */
    const onRemoved = (removedId) => {
      if (removedId === tabId) {
        finish('removed');
      }
    };

    try {
      if (checkCancelled()) {
        return;
      }
      tabs.onUpdated.addListener(onUpdated);
      updateAttached = true;
      tabs.onRemoved.addListener(onRemoved);
      removalAttached = true;
      timer = setTimeout(() => finish('timeout'), timeoutMs);
      if (isCancelled) {
        cancelTimer = setInterval(() => {
          try {
            checkCancelled();
          } catch {
            finish('error');
          }
        }, 100);
      }
      readCurrent();
    } catch {
      finish('error');
    }
  });
}

/**
 * Canonical message action names exchanged between the popup, the service
 * worker, and the content script. Import this in ESM contexts (popup.js,
 * service.js) so a typo is a load-time reference error instead of a silently
 * ignored message.
 *
 * NOTE: MV3 content scripts run as classic scripts and cannot `import`, so
 * js/content.js keeps string literals — they MUST stay equal to the values
 * below (covered by a regression test).
 */

import {withTimeout} from '/js/async-utils.js';

// Popup → service worker commands.
export const ACTIONS = {
  START: 'start',
  SCHEDULE: 'schedule',
  STOP: 'stop',
  ACTIVITY: 'activity',
  CLEAR_BROWSING_DATA: 'clearBrowsingData',
  SIMULATE: 'simulate',
};

// Service worker → content script commands (kept here as the single source of
// truth; content.js mirrors these literally).
export const CONTENT_ACTIONS = {
  PING: 'ping',
  LOGIN: 'login',
  QUERY: 'query',
  PERFORM: 'perform',
  CHECK_REWARDS_SESSION: 'checkRewardsSession',
  CLOSE_POPUPS: 'closePopups',
};

// Default timeout for popup → service-worker round trips. MV3 workers can be
// asleep; a bounded wait keeps the UI from hanging forever on a lost message.
export const MESSAGE_TIMEOUT_MS = 20000;

/**
 * Sends a UI command with a bounded wait and releases its timer on every exit.
 * Promise.race also handles a reply/rejection that arrives after the deadline.
 * @param {!Object} message Service-worker command payload.
 * @param {number=} timeoutMs Maximum response wait in milliseconds.
 * @return {!Promise<*>} The service worker's response.
 */
export function sendMessageWithTimeout(
    message, timeoutMs = MESSAGE_TIMEOUT_MS) {
  return withTimeout(
      () => chrome.runtime.sendMessage(message), timeoutMs,
      `Không nhận được phản hồi sau ${timeoutMs} ms`);
}

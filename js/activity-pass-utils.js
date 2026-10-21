/**
 * Pure helpers shared by the Dashboard and Keep-earning activity passes in
 * service.js. Kept here (import-free, side-effect-free) so the formatting that
 * was duplicated byte-for-byte between the two passes can be unit-tested and
 * fixed in one place. The passes themselves stay in service.js because they are
 * coupled to chrome.* / debugger side effects.
 */

/**
 * @typedef {{text: string}} ActivityDiagClick
 */
/**
 * @typedef {{text: string, reason: (string|undefined)}} ActivityDiagSkip
 */
/**
 * @typedef {{clicked: (!Array<!ActivityDiagClick>|undefined),
 *     skipped: (!Array<!ActivityDiagSkip>|undefined), reason: (?string|
 * undefined), pointDelta: (number|null|undefined), processedTabs:
 * (number|undefined), confirmed: (boolean|undefined)}} ActivityDiagStats
 */

/**
 * Builds the one-line `[DIAG]` summary emitted at the end of each activity
 * pass. `label` is the pass name ("Dashboard" or "Earn"); the output must stay
 * stable so the diagnostic log format does not drift between the two passes.
 * @param {string} label Pass name copied into the summary.
 * @param {number} pass 1-based pass counter.
 * @param {!ActivityDiagStats} stats Clicks, skips and point outcome. Missing
 *     arrays are treated as empty.
 * @return {string} Single diagnostic line, including a dash for an empty
 *     reason.
 */
export function formatActivityDiag(
    label,
    pass,
    {clicked = [], skipped = [], reason, pointDelta, processedTabs, confirmed},
) {
  return `[DIAG] ${label} pass ${pass}: clicked=${
      JSON.stringify(
          clicked.map((c) => c.text),
          )} skipped=${
      JSON.stringify(
          skipped.map((s) => (s.reason ? `${s.text} <${s.reason}>` : s.text)),
          )} reason=${reason || '-'} delta=${pointDelta} processedTabs=${
      processedTabs} confirmed=${confirmed}`;
}

/**
 * A successful score delta is terminal even if the claim dialog has not
 * disappeared yet. Without this guard, a slow React update can leave the
 * confirm button visible and the next pass presses it a second time.
 * @param {{clicked: (boolean|undefined), count: (number|undefined),
 *     pointDelta: (number|undefined), retry: (boolean|undefined)}=} progress
 *     Claim-pass counters. Omitted fields count as unfinished.
 * @return {boolean} Whether another confirm press must not run.
 */
export function shouldStopClaimPass({
  clicked,
  count,
  pointDelta,
  retry,
} = {}) {
  if (Number.isFinite(pointDelta) && pointDelta > 0) {
    return true;
  }
  if (retry) {
    return false;
  }
  return !clicked || count === 0;
}

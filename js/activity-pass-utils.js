/**
 * Pure helpers shared by the Dashboard and Keep-earning activity passes in
 * service.js. Kept here (import-free, side-effect-free) so the formatting that
 * was duplicated byte-for-byte between the two passes can be unit-tested and
 * fixed in one place. The passes themselves stay in service.js because they are
 * coupled to chrome.* / debugger side effects.
 */

// Build the one-line `[DIAG]` summary emitted at the end of each activity pass.
// `label` is the pass name ("Dashboard" | "Earn"); the output must stay stable
// so the diagnostic log format does not drift between the two passes.
export function formatActivityDiag(
  label,
  pass,
  { clicked = [], skipped = [], reason, pointDelta, processedTabs, confirmed },
) {
  return `[DIAG] ${label} pass ${pass}: clicked=${JSON.stringify(
    clicked.map((c) => c.text),
  )} skipped=${JSON.stringify(
    skipped.map((s) => (s.reason ? `${s.text} <${s.reason}>` : s.text)),
  )} reason=${reason || "-"} delta=${pointDelta} processedTabs=${processedTabs} confirmed=${confirmed}`;
}

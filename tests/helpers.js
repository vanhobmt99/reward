/**
 * tests/helpers.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure helper functions extracted from sharedScriptHelpers() / service.js
 * so they can be unit-tested in Node without Chrome APIs or a real browser.
 *
 * The implementations here must stay in sync with the versions in service.js.
 */

"use strict";

// ── normalize ─────────────────────────────────────────────────────────────────
function normalize(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

// ── textOf ────────────────────────────────────────────────────────────────────
function textOf(el) {
  const visible = normalize(el?.innerText || el?.textContent || "");
  const accessible = normalize(
    [el?.getAttribute?.("aria-label"), el?.getAttribute?.("title")]
      .filter(Boolean)
      .join(" "),
  );
  if (!visible) return accessible;
  if (!accessible) return visible;
  return visible.toLowerCase().includes(accessible.toLowerCase())
    ? visible
    : normalize(visible + " " + accessible);
}

// ── isVisible (requires a DOM environment) ────────────────────────────────────
function isVisible(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.opacity !== "0" &&
    el.getAttribute("aria-hidden") !== "true" &&
    el.getAttribute("aria-disabled") !== "true" &&
    !el.disabled &&
    rect.top < window.innerHeight &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.right > 0
  );
}

// ── clickTargetFor ────────────────────────────────────────────────────────────
function clickTargetFor(el) {
  return (
    el.closest(
      'button, a[href], [role="button"], [role="radio"], [tabindex]:not([tabindex="-1"])',
    ) ||
    el.closest("label") ||
    el
  );
}

// ── Priority scoring (mirrors the solve script logic) ────────────────────────
const PRIORITY_SELECTORS = [
  'input[type="radio"]:not(:checked)',
  "[data-option-index]",
  '[data-testid*="answer" i]',
  '[data-testid*="option" i]',
  ".rqOption, .rq_button, .wk_choicesInstLink, .bt_option, .quizOption",
  '[role="radio"]',
  '[class*="option"]',
  '[role="button"]',
  "button",
  "[aria-label]",
];

const REJECT_TEXT =
  /share|see results|feedback|close|back|sign in|skip|settings|privacy|terms|dashboard|rewards home|^search$|images|videos|maps|news|shopping|copilot/i;
const HARD_REJECT =
  /download|install|add to|extension|browser extension|subscribe|subscription|trial|set default|make default|open app|get app|mobile app|redeem|gift card|coupon|discount|cashback|shop now|buy now|donate|sweepstake|entries/i;
const PREFER_TEXT =
  /answer|option|choice|start|play|next|continue|submit|quiz|poll|true|false/i;

function scoreCandidate(candidate, priority) {
  const target = clickTargetFor(candidate);
  let score = priority * 10;
  const text = normalize(
    target.innerText ||
      target.textContent ||
      target.value ||
      target.getAttribute("aria-label") ||
      candidate.getAttribute("aria-label"),
  );
  if (PREFER_TEXT.test(text)) score -= 15;
  const className = String(candidate.className || target.className || "");
  if (/option|answer|choice|quiz|poll|rq|wk_|bt_/i.test(className)) score -= 10;
  if (
    candidate.hasAttribute("data-option-index") ||
    /answer|option/i.test(candidate.getAttribute("data-testid") || "")
  )
    score -= 10;
  return score;
}

module.exports = {
  normalize,
  textOf,
  isVisible,
  clickTargetFor,
  scoreCandidate,
  REJECT_TEXT,
  HARD_REJECT,
  PREFER_TEXT,
  PRIORITY_SELECTORS,
};

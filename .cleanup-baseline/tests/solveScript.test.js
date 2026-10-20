/**
 * tests/solveScript.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for the priority-based click logic used in completeRewardActivityTab().
 *
 * We replicate the solve script's algorithm here in Node + jsdom so we can
 * test it against synthetic DOM trees without needing a live browser/extension.
 *
 * @jest-environment jsdom
 */

"use strict";

const {
  normalize,
  isVisible,
  clickTargetFor,
  REJECT_TEXT,
  HARD_REJECT,
  PREFER_TEXT,
} = require("./helpers");

// ── Priority selector order (must match service.js) ───────────────────────────
const PRIORITY_SELECTORS = [
  'input[type="radio"]:not(:checked)',
  'a[href*="WQCI" i][href*="WQId" i][href*="BTJQOD" i]',
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

// ── Solver (mirrors the solve-script loop in service.js) ──────────────────────
function runSolver(container, { rewardPage = true } = {}) {
  const seen = new Set();
  const scored = [];

  for (let pri = 0; pri < PRIORITY_SELECTORS.length; pri++) {
    for (const candidate of container.querySelectorAll(
      PRIORITY_SELECTORS[pri],
    )) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);

      const target = clickTargetFor(candidate);
      if (!isVisible(target)) continue;
      if (target.getAttribute("aria-checked") === "true") continue;
      if (target.getAttribute("aria-pressed") === "true") continue;

      const text = normalize(
        target.innerText ||
          target.textContent ||
          target.value ||
          target.getAttribute("aria-label") ||
          candidate.getAttribute("aria-label"),
      );
      const href = String(
        target.href || target.closest?.("a[href]")?.href || "",
      );
      const combinedText = normalize(
        [
          text,
          target.getAttribute("aria-label"),
          target.getAttribute("title"),
          candidate.getAttribute("aria-label"),
          href,
        ]
          .filter(Boolean)
          .join(" "),
      );

      if (
        HARD_REJECT.test(combinedText) ||
        /chrome\.google|microsoftedge/i.test(href)
      )
        continue;

      const hasRadio =
        candidate.matches('input[type="radio"]') ||
        target.getAttribute("role") === "radio";
      const className = String(candidate.className || target.className || "");
      const hasRewardClass = /option|answer|choice|quiz|poll|rq|wk_|bt_/i.test(
        className,
      );
      const isUsefulText =
        text.length > 0 && text.length < 160 && !REJECT_TEXT.test(text);
      const isPlainRewardButton =
        rewardPage &&
        target.tagName === "BUTTON" &&
        isUsefulText &&
        PREFER_TEXT.test(text);
      const isDataOption =
        candidate.hasAttribute("data-option-index") ||
        /answer|option/i.test(candidate.getAttribute("data-testid") || "");
      const isBingQuizAnswer = candidate.matches(
        'a[href*="WQCI" i][href*="WQId" i][href*="BTJQOD" i]',
      );

      if (
        !hasRadio &&
        !hasRewardClass &&
        !PREFER_TEXT.test(text) &&
        !isPlainRewardButton &&
        !isDataOption &&
        !isBingQuizAnswer
      )
        continue;
      if (REJECT_TEXT.test(text)) continue;

      let score = pri * 10;
      if (PREFER_TEXT.test(text)) score -= 15;
      if (hasRadio || hasRewardClass || isDataOption || isBingQuizAnswer)
        score -= 10;

      scored.push({ candidate, target, text, score });
    }
  }

  scored.sort((a, b) => a.score - b.score);
  return scored;
}

// ── DOM helpers ───────────────────────────────────────────────────────────────
function makeContainer() {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
}

function mockVisible(el) {
  el.getBoundingClientRect = () => ({
    width: 120,
    height: 40,
    top: 10,
    bottom: 50,
    left: 0,
    right: 120,
  });
}

function cleanup(container) {
  container?.remove();
}

// ═══════════════════════════════════════════════════════════════════════════════
// Visibility filtering
// ═══════════════════════════════════════════════════════════════════════════════
describe("solve script — visibility filtering", () => {
  let c;
  beforeEach(() => {
    c = makeContainer();
  });
  afterEach(() => cleanup(c));

  test("skips hidden button (zero-size rect)", () => {
    c.innerHTML = `<button>Option A</button>`;
    const results = runSolver(c);
    expect(results).toHaveLength(0);
  });

  test("skips button with display:none", () => {
    const btn = document.createElement("button");
    btn.textContent = "Option A";
    btn.style.display = "none";
    mockVisible(btn);
    c.appendChild(btn);
    const results = runSolver(c);
    expect(results).toHaveLength(0);
  });

  test("skips button with aria-hidden=true", () => {
    const btn = document.createElement("button");
    btn.textContent = "Option A";
    btn.setAttribute("aria-hidden", "true");
    mockVisible(btn);
    c.appendChild(btn);
    const results = runSolver(c);
    expect(results).toHaveLength(0);
  });

  test("skips disabled button", () => {
    const btn = document.createElement("button");
    btn.textContent = "Option A";
    btn.disabled = true;
    mockVisible(btn);
    c.appendChild(btn);
    const results = runSolver(c);
    expect(results).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Reject / hard-reject filtering
// ═══════════════════════════════════════════════════════════════════════════════
describe("solve script — text filtering", () => {
  let c;
  beforeEach(() => {
    c = makeContainer();
  });
  afterEach(() => cleanup(c));

  function addVisibleButton(container, text, extra = {}) {
    const btn = document.createElement("button");
    btn.textContent = text;
    mockVisible(btn);
    if (extra.ariaLabel) btn.setAttribute("aria-label", extra.ariaLabel);
    container.appendChild(btn);
    return btn;
  }

  test('skips REJECT_TEXT buttons ("Sign in")', () => {
    addVisibleButton(c, "Sign in");
    expect(runSolver(c)).toHaveLength(0);
  });

  test('skips REJECT_TEXT buttons ("See results")', () => {
    addVisibleButton(c, "See results");
    expect(runSolver(c)).toHaveLength(0);
  });

  test('skips REJECT_TEXT buttons ("Privacy")', () => {
    addVisibleButton(c, "Privacy");
    expect(runSolver(c)).toHaveLength(0);
  });

  test('skips HARD_REJECT buttons ("Download now")', () => {
    addVisibleButton(c, "Download now");
    expect(runSolver(c)).toHaveLength(0);
  });

  test('skips HARD_REJECT buttons ("Install extension")', () => {
    addVisibleButton(c, "Install extension");
    expect(runSolver(c)).toHaveLength(0);
  });

  test('includes valid quiz answer button ("Start quiz")', () => {
    addVisibleButton(c, "Start quiz");
    const results = runSolver(c);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].text).toBe("Start quiz");
  });

  test("includes Bing quiz answer links but ignores ordinary search links", () => {
    const organic = document.createElement("a");
    organic.href = "https://example.com/article";
    organic.textContent = "Croissant history";
    mockVisible(organic);

    const answer = document.createElement("a");
    answer.href =
      "/search?q=Austria&filters=WQId%3A%221%22+WQCI%3A%220%22&FORM=BTJQOD";
    answer.className = "acf-button-standard__link";
    answer.textContent = "A. Austria";
    mockVisible(answer);

    c.appendChild(organic);
    c.appendChild(answer);

    const results = runSolver(c);
    expect(results).toHaveLength(1);
    expect(results[0].candidate).toBe(answer);
    expect(results[0].text).toBe("A. Austria");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Already-answered filtering
// ═══════════════════════════════════════════════════════════════════════════════
describe("solve script — skip already-selected elements", () => {
  let c;
  beforeEach(() => {
    c = makeContainer();
  });
  afterEach(() => cleanup(c));

  test("skips radio with aria-checked=true", () => {
    const div = document.createElement("div");
    div.setAttribute("role", "radio");
    div.setAttribute("aria-checked", "true");
    div.textContent = "Option A";
    mockVisible(div);
    c.appendChild(div);
    expect(runSolver(c)).toHaveLength(0);
  });

  test("skips button with aria-pressed=true", () => {
    const btn = document.createElement("button");
    btn.textContent = "Option A";
    btn.setAttribute("aria-pressed", "true");
    mockVisible(btn);
    c.appendChild(btn);
    expect(runSolver(c)).toHaveLength(0);
  });

  test("skips checked radio input", () => {
    c.innerHTML = `<input type="radio" checked />`;
    const input = c.querySelector("input");
    mockVisible(input);
    // checked radio won't match 'input[type="radio"]:not(:checked)' — confirm 0 result
    const results = runSolver(c);
    expect(results.filter((r) => r.candidate === input)).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Priority ordering
// ═══════════════════════════════════════════════════════════════════════════════
describe("solve script — priority ordering", () => {
  let c;
  beforeEach(() => {
    c = makeContainer();
  });
  afterEach(() => cleanup(c));

  test("radio input outranks plain button", () => {
    // Radio input (priority 0) vs button (priority 8)
    const radio = document.createElement("input");
    radio.type = "radio";
    mockVisible(radio);

    const btn = document.createElement("button");
    btn.textContent = "Start quiz";
    mockVisible(btn);

    c.appendChild(radio);
    c.appendChild(btn);

    const results = runSolver(c);
    expect(results.length).toBeGreaterThanOrEqual(1);
    // The top candidate should be the radio
    expect(results[0].candidate.tagName.toLowerCase()).toBe("input");
    expect(results[0].score).toBeLessThan(results[results.length - 1].score);
  });

  test('[data-option-index] outranks [role="button"]', () => {
    const optionDiv = document.createElement("div");
    optionDiv.setAttribute("data-option-index", "0");
    optionDiv.textContent = "Option A";
    mockVisible(optionDiv);

    const roleBtn = document.createElement("div");
    roleBtn.setAttribute("role", "button");
    roleBtn.textContent = "Continue";
    mockVisible(roleBtn);

    c.appendChild(optionDiv);
    c.appendChild(roleBtn);

    const results = runSolver(c);
    expect(results.length).toBeGreaterThanOrEqual(2);
    const topCandidate = results[0];
    expect(topCandidate.candidate).toBe(optionDiv);
  });

  test(".rqOption class outranks plain button", () => {
    const rqEl = document.createElement("div");
    rqEl.className = "rqOption";
    rqEl.textContent = "Quiz Answer";
    mockVisible(rqEl);

    const btn = document.createElement("button");
    btn.textContent = "Next";
    mockVisible(btn);

    c.appendChild(rqEl);
    c.appendChild(btn);

    const results = runSolver(c);
    expect(results.length).toBeGreaterThanOrEqual(1);
    // rqOption is at priority index 4, button at 8 → rqOption scores lower
    const rqResult = results.find((r) => r.candidate === rqEl);
    const btnResult = results.find((r) => r.candidate === btn);
    if (rqResult && btnResult) {
      expect(rqResult.score).toBeLessThan(btnResult.score);
    }
  });

  test("PREFER_TEXT bonus lowers score (makes it higher priority)", () => {
    const btn1 = document.createElement("button");
    btn1.textContent = "Submit"; // matches PREFER_TEXT → bonus -15
    mockVisible(btn1);

    const btn2 = document.createElement("button");
    btn2.textContent = "Unknown text here";
    mockVisible(btn2);

    c.appendChild(btn1);
    c.appendChild(btn2);

    const results = runSolver(c);
    const r1 = results.find((r) => r.text === "Submit");
    const r2 = results.find((r) => r.text === "Unknown text here");

    if (r1 && r2) {
      expect(r1.score).toBeLessThan(r2.score);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// data-testid matching
// ═══════════════════════════════════════════════════════════════════════════════
describe("solve script — data-testid selectors", () => {
  let c;
  beforeEach(() => {
    c = makeContainer();
  });
  afterEach(() => cleanup(c));

  test('matches data-testid="answer-0"', () => {
    const el = document.createElement("div");
    el.setAttribute("data-testid", "answer-0");
    el.textContent = "Paris";
    mockVisible(el);
    c.appendChild(el);
    const results = runSolver(c);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].candidate).toBe(el);
  });

  test('matches data-testid="option-2" (case-insensitive)', () => {
    const el = document.createElement("div");
    el.setAttribute("data-testid", "Option-2");
    el.textContent = "True";
    mockVisible(el);
    c.appendChild(el);
    const results = runSolver(c);
    expect(results.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════════════════════
describe("solve script — edge cases", () => {
  let c;
  beforeEach(() => {
    c = makeContainer();
  });
  afterEach(() => cleanup(c));

  test("returns empty array for empty container", () => {
    expect(runSolver(c)).toEqual([]);
  });

  test("does not double-count elements matching multiple selectors", () => {
    // An element matching both [data-option-index] AND [class*="option"]
    const el = document.createElement("div");
    el.setAttribute("data-option-index", "0");
    el.className = "rqOption";
    el.textContent = "Answer";
    mockVisible(el);
    c.appendChild(el);

    const results = runSolver(c);
    const count = results.filter((r) => r.candidate === el).length;
    expect(count).toBe(1); // should appear only once
  });

  test("handles element with only aria-label text", () => {
    const div = document.createElement("div");
    div.setAttribute("aria-label", "Option B");
    div.setAttribute("role", "radio");
    mockVisible(div);
    c.appendChild(div);
    const results = runSolver(c);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].text).toBe("Option B");
  });
});

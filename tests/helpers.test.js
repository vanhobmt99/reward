/**
 * tests/helpers.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for pure helper functions used inside the browser-injected scripts.
 *
 * Tests run in jsdom so DOM APIs (getBoundingClientRect, getComputedStyle) work.
 * @jest-environment jsdom
 */

"use strict";

const {
  normalize,
  textOf,
  isVisible,
  clickTargetFor,
  REJECT_TEXT,
  HARD_REJECT,
  PREFER_TEXT,
} = require("./helpers");

// ═══════════════════════════════════════════════════════════════════════════════
// normalize()
// ═══════════════════════════════════════════════════════════════════════════════
describe("normalize()", () => {
  test("collapses multiple spaces to single space", () => {
    expect(normalize("hello   world")).toBe("hello world");
  });

  test("trims leading and trailing whitespace", () => {
    expect(normalize("  hello  ")).toBe("hello");
  });

  test("collapses newlines and tabs", () => {
    expect(normalize("hello\n\t  world")).toBe("hello world");
  });

  test("returns empty string for null", () => {
    expect(normalize(null)).toBe("");
  });

  test("returns empty string for undefined", () => {
    expect(normalize(undefined)).toBe("");
  });

  test("returns empty string for empty string", () => {
    expect(normalize("")).toBe("");
  });

  test("returns unchanged single-word string", () => {
    expect(normalize("hello")).toBe("hello");
  });

  test("handles mixed whitespace characters", () => {
    expect(normalize("a\r\n  b\t  c")).toBe("a b c");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// textOf()
// ═══════════════════════════════════════════════════════════════════════════════
describe("textOf()", () => {
  function makeEl({ textContent = "", ariaLabel = null, title = null } = {}) {
    return {
      innerText: textContent,
      textContent,
      getAttribute(attr) {
        if (attr === "aria-label") return ariaLabel;
        if (attr === "title") return title;
        return null;
      },
    };
  }

  test("returns textContent when no aria-label", () => {
    expect(textOf(makeEl({ textContent: "click me" }))).toBe("click me");
  });

  test("returns aria-label when no visible text", () => {
    expect(
      textOf(makeEl({ textContent: "", ariaLabel: "submit button" })),
    ).toBe("submit button");
  });

  test("returns title when no textContent and no aria-label", () => {
    expect(textOf(makeEl({ textContent: "", title: "help tooltip" }))).toBe(
      "help tooltip",
    );
  });

  test("returns only visible text when it already contains aria-label", () => {
    // "Submit form" includes "submit form" → visible wins
    expect(
      textOf(
        makeEl({ textContent: "Submit form now", ariaLabel: "Submit form" }),
      ),
    ).toBe("Submit form now");
  });

  test("combines visible + aria-label when they differ", () => {
    expect(
      textOf(makeEl({ textContent: "Click", ariaLabel: "Submit form" })),
    ).toBe("Click Submit form");
  });

  test("returns empty string for null element", () => {
    expect(textOf(null)).toBe("");
  });

  test("normalizes whitespace in result", () => {
    expect(textOf(makeEl({ textContent: "  Quiz  " }))).toBe("Quiz");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// isVisible() — requires jsdom
// ═══════════════════════════════════════════════════════════════════════════════
describe("isVisible()", () => {
  // jsdom's getBoundingClientRect returns all zeros by default.
  // We need to mock it to return meaningful values for visible elements.

  function mockRect(el, overrides = {}) {
    const rect = {
      width: 100,
      height: 40,
      top: 10,
      bottom: 50,
      left: 0,
      right: 100,
      ...overrides,
    };
    el.getBoundingClientRect = () => rect;
  }

  test("returns false for null", () => {
    expect(isVisible(null)).toBe(false);
  });

  test("returns false for zero-size element", () => {
    const el = document.createElement("button");
    document.body.appendChild(el);
    // jsdom default rect is all-zero — should be invisible
    expect(isVisible(el)).toBe(false);
    el.remove();
  });

  test("returns false when display is none", () => {
    const el = document.createElement("button");
    mockRect(el);
    el.style.display = "none";
    document.body.appendChild(el);
    expect(isVisible(el)).toBe(false);
    el.remove();
  });

  test("returns false when visibility is hidden", () => {
    const el = document.createElement("button");
    mockRect(el);
    el.style.visibility = "hidden";
    document.body.appendChild(el);
    expect(isVisible(el)).toBe(false);
    el.remove();
  });

  test("returns false when opacity is 0", () => {
    const el = document.createElement("button");
    mockRect(el);
    el.style.opacity = "0";
    document.body.appendChild(el);
    expect(isVisible(el)).toBe(false);
    el.remove();
  });

  test("returns false when aria-hidden is true", () => {
    const el = document.createElement("button");
    mockRect(el);
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
    expect(isVisible(el)).toBe(false);
    el.remove();
  });

  test("returns false when aria-disabled is true", () => {
    const el = document.createElement("button");
    mockRect(el);
    el.setAttribute("aria-disabled", "true");
    document.body.appendChild(el);
    expect(isVisible(el)).toBe(false);
    el.remove();
  });

  test("returns false when element is disabled", () => {
    const el = document.createElement("button");
    mockRect(el);
    el.disabled = true;
    document.body.appendChild(el);
    expect(isVisible(el)).toBe(false);
    el.remove();
  });

  test("returns false when element is below viewport (top >= innerHeight)", () => {
    const el = document.createElement("button");
    mockRect(el, { top: 99999, bottom: 100039 }); // way below viewport
    document.body.appendChild(el);
    expect(isVisible(el)).toBe(false);
    el.remove();
  });

  test("returns false when element is above viewport (bottom <= 0)", () => {
    const el = document.createElement("button");
    mockRect(el, { top: -100, bottom: -10 });
    document.body.appendChild(el);
    expect(isVisible(el)).toBe(false);
    el.remove();
  });

  test("returns false when element is right of viewport (left >= innerWidth)", () => {
    const el = document.createElement("button");
    mockRect(el, {
      left: window.innerWidth + 10,
      right: window.innerWidth + 110,
    });
    document.body.appendChild(el);
    expect(isVisible(el)).toBe(false);
    el.remove();
  });

  test("returns false when element is left of viewport (right <= 0)", () => {
    const el = document.createElement("button");
    mockRect(el, { left: -120, right: -20 });
    document.body.appendChild(el);
    expect(isVisible(el)).toBe(false);
    el.remove();
  });

  test("returns true for a normal visible element", () => {
    const el = document.createElement("button");
    mockRect(el, { width: 100, height: 40, top: 10, bottom: 50 });
    document.body.appendChild(el);
    expect(isVisible(el)).toBe(true);
    el.remove();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// clickTargetFor()
// ═══════════════════════════════════════════════════════════════════════════════
describe("clickTargetFor()", () => {
  test("returns the element itself when no ancestor matches", () => {
    const el = document.createElement("span");
    document.body.appendChild(el);
    expect(clickTargetFor(el)).toBe(el);
    el.remove();
  });

  test("returns nearest button ancestor", () => {
    const btn = document.createElement("button");
    const span = document.createElement("span");
    btn.appendChild(span);
    document.body.appendChild(btn);
    expect(clickTargetFor(span)).toBe(btn);
    btn.remove();
  });

  test('returns nearest [role="button"] ancestor', () => {
    const div = document.createElement("div");
    div.setAttribute("role", "button");
    const inner = document.createElement("span");
    div.appendChild(inner);
    document.body.appendChild(div);
    expect(clickTargetFor(inner)).toBe(div);
    div.remove();
  });

  test("returns nearest <a href> ancestor", () => {
    const a = document.createElement("a");
    a.href = "https://example.com";
    const span = document.createElement("span");
    a.appendChild(span);
    document.body.appendChild(a);
    expect(clickTargetFor(span)).toBe(a);
    a.remove();
  });

  test("returns nearest <label> ancestor when no button/a", () => {
    const label = document.createElement("label");
    const text = document.createTextNode("Option");
    label.appendChild(text);
    const span = document.createElement("span");
    label.appendChild(span);
    document.body.appendChild(label);
    expect(clickTargetFor(span)).toBe(label);
    label.remove();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Reject/prefer regex patterns
// ═══════════════════════════════════════════════════════════════════════════════
describe("REJECT_TEXT regex", () => {
  test("matches navigation/UI texts that should be skipped", () => {
    expect(REJECT_TEXT.test("Share")).toBe(true);
    expect(REJECT_TEXT.test("Sign in")).toBe(true);
    expect(REJECT_TEXT.test("See results")).toBe(true);
    expect(REJECT_TEXT.test("Privacy")).toBe(true);
    expect(REJECT_TEXT.test("Copilot")).toBe(true);
  });

  test("does not match legitimate answer text", () => {
    expect(REJECT_TEXT.test("Mount Everest")).toBe(false);
    expect(REJECT_TEXT.test("Paris")).toBe(false);
    expect(REJECT_TEXT.test("True")).toBe(false);
    expect(REJECT_TEXT.test("Option A")).toBe(false);
  });
});

describe("HARD_REJECT regex", () => {
  test("matches dangerous CTA texts", () => {
    expect(HARD_REJECT.test("Download now")).toBe(true);
    expect(HARD_REJECT.test("Install extension")).toBe(true);
    expect(HARD_REJECT.test("Subscribe to newsletter")).toBe(true);
    expect(HARD_REJECT.test("Redeem points")).toBe(true);
    expect(HARD_REJECT.test("Shop now")).toBe(true);
  });

  test("does not match safe quiz/answer text", () => {
    expect(HARD_REJECT.test("Answer A")).toBe(false);
    expect(HARD_REJECT.test("True or False")).toBe(false);
    expect(HARD_REJECT.test("Continue quiz")).toBe(false);
  });
});

describe("PREFER_TEXT regex", () => {
  test("matches high-value target texts", () => {
    expect(PREFER_TEXT.test("Answer")).toBe(true);
    expect(PREFER_TEXT.test("Option B")).toBe(true);
    expect(PREFER_TEXT.test("Start quiz")).toBe(true);
    expect(PREFER_TEXT.test("Submit")).toBe(true);
    expect(PREFER_TEXT.test("True")).toBe(true);
    expect(PREFER_TEXT.test("False")).toBe(true);
  });

  test("does not match generic text", () => {
    expect(PREFER_TEXT.test("Hello")).toBe(false);
    expect(PREFER_TEXT.test("Paris")).toBe(false);
  });
});

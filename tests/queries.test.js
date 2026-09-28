/**
 * tests/queries.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Data-validation tests for js/queries_extra.js.
 *
 * Because queries_extra.js uses ES module syntax (export const …), we read
 * and parse the file manually to extract the data without needing a full
 * ESM transformer.
 */

"use strict";

const fs = require("fs");
const path = require("path");

// Load queriesExtra by stripping the ESM export keyword, then evaluate via
// Function constructor (avoids 'assignment to const' error from plain eval).
const RAW = fs.readFileSync(
  path.resolve(__dirname, "../js/queries_extra.js"),
  "utf8",
);
const normalized = RAW.replace(/^export\s+const\s+/, "const ");
const queriesExtra = new Function(`${normalized}; return queriesExtra;`)();

// ── Expected categories ───────────────────────────────────────────────────────
const EXPECTED_CATEGORIES = [
  "sports",
  "food",
  "health",
  "finance",
  "science",
  "gaming",
  "nature",
  "history",
  "vietnam",
];

const MIN_QUERIES_PER_CATEGORY = 50;
const MAX_QUERY_LENGTH = 200;

// ═══════════════════════════════════════════════════════════════════════════════
// Structure validation
// ═══════════════════════════════════════════════════════════════════════════════
describe("queriesExtra — structure", () => {
  test("is a non-null plain object", () => {
    expect(queriesExtra).toBeDefined();
    expect(typeof queriesExtra).toBe("object");
    expect(queriesExtra).not.toBeNull();
    expect(Array.isArray(queriesExtra)).toBe(false);
  });

  test("contains all expected categories", () => {
    for (const cat of EXPECTED_CATEGORIES) {
      expect(queriesExtra).toHaveProperty(cat);
    }
  });

  test("has no unexpected extra keys", () => {
    const keys = Object.keys(queriesExtra);
    for (const key of keys) {
      expect(EXPECTED_CATEGORIES).toContain(key);
    }
  });

  test("every value is a non-empty array", () => {
    for (const [, list] of Object.entries(queriesExtra)) {
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Content validation — per category
// ═══════════════════════════════════════════════════════════════════════════════
describe("queriesExtra — content", () => {
  for (const [cat, list] of Object.entries(queriesExtra || {})) {
    describe(`category: ${cat}`, () => {
      test(`has at least ${MIN_QUERIES_PER_CATEGORY} queries`, () => {
        expect(list.length).toBeGreaterThanOrEqual(MIN_QUERIES_PER_CATEGORY);
      });

      test("all entries are non-empty strings", () => {
        for (const q of list) {
          expect(typeof q).toBe("string");
          expect(q.trim().length).toBeGreaterThan(0);
        }
      });

      test(`all queries are under ${MAX_QUERY_LENGTH} characters`, () => {
        for (const q of list) {
          expect(q.length).toBeLessThanOrEqual(MAX_QUERY_LENGTH);
        }
      });

      test("no duplicate queries (case-insensitive)", () => {
        const seen = new Set();
        const dupes = [];
        for (const q of list) {
          const key = q.trim().toLowerCase();
          if (seen.has(key)) dupes.push(q);
          seen.add(key);
        }
        expect(dupes).toEqual([]);
      });

      test("no empty or whitespace-only queries", () => {
        const bad = list.filter((q) => q.trim() === "");
        expect(bad).toEqual([]);
      });
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Cross-category uniqueness
// ═══════════════════════════════════════════════════════════════════════════════
describe("queriesExtra — cross-category uniqueness", () => {
  test("no query appears in more than one category", () => {
    const seen = new Map(); // query → first category
    const dupes = [];

    for (const [cat, list] of Object.entries(queriesExtra || {})) {
      for (const q of list) {
        const key = q.trim().toLowerCase();
        if (seen.has(key)) {
          dupes.push({ query: q, cat1: seen.get(key), cat2: cat });
        } else {
          seen.set(key, cat);
        }
      }
    }

    // Report all duplicates for easier debugging
    if (dupes.length > 0) {
      console.warn("Cross-category duplicates found:", dupes);
    }
    expect(dupes).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Total query count
// ═══════════════════════════════════════════════════════════════════════════════
describe("queriesExtra — totals", () => {
  test("total query count across all categories is at least 400", () => {
    const total = Object.values(queriesExtra || {}).reduce(
      (sum, list) => sum + list.length,
      0,
    );
    expect(total).toBeGreaterThanOrEqual(400);
  });
});

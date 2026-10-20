/**
 * tests/queries_core.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Data-validation tests for js/queries.js.
 */

"use strict";

const fs = require("fs");
const path = require("path");

// Load queries by stripping the ESM export keyword, then evaluate via
// Function constructor.
const RAW = fs.readFileSync(
  path.resolve(__dirname, "../js/queries.js"),
  "utf8",
);
const normalized = RAW.replace(/^const\s+queries=/, "const queries=").replace(
  /export\s*\{\s*queries\s*\}\s*;?\s*$/,
  "return queries;",
);
const queries = new Function(`${normalized}`)();

const EXPECTED_CATEGORIES = [
  "tech",
  "sports",
  "food",
  "health",
  "finance",
  "science",
  "gaming",
  "nature",
  "history",
  "random",
];

const MIN_QUERIES_PER_CATEGORY = 50;
const MAX_QUERY_LENGTH = 200;

describe("queriesCore — structure", () => {
  test("is a non-null plain object", () => {
    expect(queries).toBeDefined();
    expect(typeof queries).toBe("object");
    expect(queries).not.toBeNull();
    expect(Array.isArray(queries)).toBe(false);
  });

  test("contains all expected categories", () => {
    for (const cat of EXPECTED_CATEGORIES) {
      expect(queries).toHaveProperty(cat);
    }
  });

  test("has no unexpected extra keys", () => {
    const keys = Object.keys(queries);
    for (const key of keys) {
      expect(EXPECTED_CATEGORIES).toContain(key);
    }
  });

  test("every value is a non-empty array", () => {
    for (const [, list] of Object.entries(queries)) {
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);
    }
  });
});

describe("queriesCore — content", () => {
  for (const [cat, list] of Object.entries(queries || {})) {
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
    });
  }
});

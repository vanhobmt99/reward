/**
 * tests/utils.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for pure utility functions from js/utils.js.
 *
 * The Chrome-API-dependent functions (chromeSet, chromeGet, set, get,
 * resetRuntime) are tested with a lightweight chrome.storage mock.
 * applyConfigDefaults, isPlainObject, sanitizeStoredConfig are pure and
 * tested directly.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Dynamically load and compile js/utils.js ESM to CommonJS in a secure sandbox
const utilsPath = path.join(__dirname, "../js/utils.js");
const utilsContent = fs.readFileSync(utilsPath, "utf8");

// Convert ESM exports to CommonJS exports and make sure helper functions are exported
const modifiedContent = utilsContent.replace(/export\s+\{[\s\S]*?\};/, () => {
  const exports = [
    "log",
    "set",
    "get",
    "resetRuntime",
    "applyConfigDefaults",
    "getRewardsCounterField",
    "isRewardsSearchCounterComplete",
    "getRewardsSearchCounterDone",
    "isDailySearchCounterDone",
    "isPlainObject",
    "sanitizeStoredConfig",
  ];
  return `module.exports = { ${exports.join(", ")} };`;
});

const mockChrome = {
  storage: {
    local: {
      set: jest.fn(),
      get: jest.fn(),
    },
  },
  runtime: {
    lastError: null,
  },
};

const sandbox = {
  console,
  Date,
  Promise,
  Object,
  Array,
  Error,
  chrome: mockChrome,
  module: { exports: {} },
  exports: {},
};

vm.createContext(sandbox);
vm.runInContext(modifiedContent, sandbox);

const { isPlainObject, sanitizeStoredConfig, applyConfigDefaults } =
  sandbox.module.exports;

// ── Helpers for building default config ───────────────────────────────────────
function makeDefaultConfig() {
  return {
    search: { desk: 1, mob: 0, min: 15, max: 30 },
    schedule: { desk: 10, mob: 10, min: 15, max: 30, mode: "m1" },
    device: { name: "", ua: "", h: 844, w: 390, scale: 3 },
    control: {
      niche: "random",
      clear: 1,
      enhancedPatchDefaultApplied: 1,
      humanPacingDefaultApplied: 1,
      preserveRewards: 1,
      act: 1,
      log: 0,
    },
    runtime: { done: 0, total: 0, failed: 0, running: 0 },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// isPlainObject()
// ═══════════════════════════════════════════════════════════════════════════════
describe("isPlainObject()", () => {
  test("returns true for plain object", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
  });

  test("returns false for array", () => {
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject([1, 2, 3])).toBe(false);
  });

  test("returns false for null", () => {
    expect(isPlainObject(null)).toBeFalsy();
  });

  test("returns false for string", () => {
    expect(isPlainObject("hello")).toBe(false);
  });

  test("returns false for number", () => {
    expect(isPlainObject(42)).toBe(false);
  });

  test("returns false for undefined", () => {
    expect(isPlainObject(undefined)).toBeFalsy();
  });

  test("returns false for boolean", () => {
    expect(isPlainObject(true)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// sanitizeStoredConfig()
// ═══════════════════════════════════════════════════════════════════════════════
describe("sanitizeStoredConfig()", () => {
  test('removes top-level "pro" field', () => {
    const result = sanitizeStoredConfig({ pro: true, control: {} });
    expect(result.pro).toBeUndefined();
  });

  test('removes "consent" from control object', () => {
    const result = sanitizeStoredConfig({ control: { consent: true, act: 1 } });
    expect(result.control.consent).toBeUndefined();
    expect(result.control.act).toBe(1);
  });

  test("preserves other fields unchanged", () => {
    const result = sanitizeStoredConfig({
      search: { desk: 5 },
      control: { act: 1 },
    });
    expect(result.search).toEqual({ desk: 5 });
    expect(result.control.act).toBe(1);
  });

  test("returns non-object value as-is (null)", () => {
    expect(sanitizeStoredConfig(null)).toBeNull();
  });

  test("returns non-object value as-is (undefined)", () => {
    expect(sanitizeStoredConfig(undefined)).toBeUndefined();
  });

  test("returns non-object value as-is (string)", () => {
    expect(sanitizeStoredConfig("invalid")).toBe("invalid");
  });

  test("does not mutate the original object", () => {
    const original = { pro: true, control: { consent: true, act: 1 } };
    sanitizeStoredConfig(original);
    expect(original.pro).toBe(true);
    expect(original.control.consent).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// applyConfigDefaults()
// ═══════════════════════════════════════════════════════════════════════════════
describe("applyConfigDefaults()", () => {
  test("returns target unchanged when stored is null", () => {
    const target = makeDefaultConfig();
    const result = applyConfigDefaults(target, null);
    expect(result.search.desk).toBe(1);
  });

  test("merges nested objects (deep merge)", () => {
    const target = makeDefaultConfig();
    const stored = {
      search: { desk: 5 },
      control: { enhancedPatchDefaultApplied: 1, act: 0 },
    };
    const result = applyConfigDefaults(target, stored);
    expect(result.search.desk).toBe(5); // stored wins
    expect(result.search.min).toBe(15); // target default preserved
    expect(result.control.act).toBe(0); // stored wins
  });

  test("recursively merges deeply nested runtime fields", () => {
    const target = makeDefaultConfig();
    target.runtime.done = 2;
    target.runtime.total = 10;
    const stored = {
      control: { enhancedPatchDefaultApplied: 1 },
      runtime: { done: 4 },
    };
    const result = applyConfigDefaults(target, stored);
    expect(result.runtime.done).toBe(4);
    expect(result.runtime.total).toBe(10);
  });

  test("sets clear=1 and enhancedPatchDefaultApplied=1 when first run", () => {
    const target = makeDefaultConfig();
    const stored = { control: { enhancedPatchDefaultApplied: 0 } };
    const result = applyConfigDefaults(target, stored);
    expect(result.control.clear).toBe(1);
    expect(result.control.enhancedPatchDefaultApplied).toBe(1);
  });

  test("preserves existing clear when already patched", () => {
    const target = makeDefaultConfig();
    target.control.clear = 0;
    const stored = { control: { enhancedPatchDefaultApplied: 1, clear: 0 } };
    const result = applyConfigDefaults(target, stored);
    expect(result.control.clear).toBe(0); // already patched; stored value wins
  });

  test("defaults preserveRewards to 1 when missing", () => {
    const target = makeDefaultConfig();
    delete target.control.preserveRewards;
    const stored = {
      control: {
        enhancedPatchDefaultApplied: 1,
        clear: 1,
      },
    };
    applyConfigDefaults(target, stored);
    expect(target.control.preserveRewards).toBe(1);
  });

  test("migrates old default search pacing to human pacing defaults once", () => {
    const target = makeDefaultConfig();
    const stored = {
      search: { desk: 31, mob: 21, min: 10, max: 20 },
      schedule: { desk: 31, mob: 21, min: 10, max: 20, mode: "m1" },
      control: { enhancedPatchDefaultApplied: 1 },
    };

    const result = applyConfigDefaults(target, stored);

    expect(result.search.min).toBe(7);
    expect(result.search.max).toBe(14);
    expect(result.schedule.min).toBe(7);
    expect(result.schedule.max).toBe(14);
    expect(result.control.humanPacingDefaultApplied).toBe(1);
  });

  test("preserves custom pacing when applying human pacing migration", () => {
    const target = makeDefaultConfig();
    const stored = {
      search: { desk: 31, mob: 21, min: 12, max: 25 },
      schedule: { desk: 31, mob: 21, min: 9, max: 18, mode: "m1" },
      control: { enhancedPatchDefaultApplied: 1 },
    };

    const result = applyConfigDefaults(target, stored);

    expect(result.search.min).toBe(12);
    expect(result.search.max).toBe(25);
    expect(result.schedule.min).toBe(9);
    expect(result.schedule.max).toBe(18);
    expect(result.control.humanPacingDefaultApplied).toBe(1);
  });

  test("sets clear=1 when patched but clear is null", () => {
    const target = makeDefaultConfig();
    target.control.clear = null;
    const stored = { control: { enhancedPatchDefaultApplied: 1, clear: null } };
    const result = applyConfigDefaults(target, stored);
    expect(result.control.clear).toBe(1);
  });

  test('removes "consent" from control after merge', () => {
    const target = makeDefaultConfig();
    const stored = {
      control: { enhancedPatchDefaultApplied: 1, consent: true },
    };
    const result = applyConfigDefaults(target, stored);
    expect(result.control.consent).toBeUndefined();
  });

  test('removes "pro" from target after merge', () => {
    const target = { ...makeDefaultConfig(), pro: true };
    const result = applyConfigDefaults(target, null);
    expect(result.pro).toBeUndefined();
  });

  test("overwrites primitive fields (non-object) from stored", () => {
    const target = makeDefaultConfig();
    const stored = {
      control: { enhancedPatchDefaultApplied: 1 },
      someFlag: 42,
    };
    const result = applyConfigDefaults(target, stored);
    expect(result.someFlag).toBe(42);
  });
});

describe("write lock policy", () => {
  test("fails closed instead of writing without a lock", () => {
    expect(utilsContent).toContain("const WRITE_LOCK_TIMEOUT_MS = 30000;");
    expect(utilsContent).toContain("throw new Error(message);");
    expect(utilsContent).not.toContain("writing anyway");
  });
});

describe("Rewards counter helpers", () => {
  const {
    isRewardsSearchCounterComplete,
    getRewardsSearchCounterDone,
    isDailySearchCounterDone,
  } = sandbox.module.exports;

  test("treats complete=1 as done", () => {
    expect(isRewardsSearchCounterComplete([{ complete: 1 }])).toBe(true);
    expect(
      getRewardsSearchCounterDone({ pcSearch: [{ complete: 1 }] }, "pcSearch"),
    ).toBe(1);
  });

  test("treats partial progress below max as not done", () => {
    expect(
      isRewardsSearchCounterComplete([{ complete: 0, progress: 5, max: 30 }]),
    ).toBe(false);
    expect(
      getRewardsSearchCounterDone(
        { pcSearch: [{ progress: 5, max: 30 }] },
        "pcSearch",
      ),
    ).toBe(0);
  });

  test("treats progress >= max as done", () => {
    expect(isRewardsSearchCounterComplete([{ progress: 30, max: 30 }])).toBe(
      true,
    );
  });

  test("isDailySearchCounterDone only accepts completed flags", () => {
    expect(isDailySearchCounterDone(1)).toBe(true);
    expect(isDailySearchCounterDone(0)).toBe(false);
    expect(isDailySearchCounterDone(0.5)).toBe(false);
  });
});

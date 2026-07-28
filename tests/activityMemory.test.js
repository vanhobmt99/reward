const { loadEsmModule } = require("./esm-loader.js");

const {
  sanitizeActivityAttempts,
  sanitizeActivityConfirmed,
  migrateActivityMemory,
  getBlockedActivityKeys,
  recordActivityFailures,
  confirmActivityKeys,
  markUnconfirmedActivityKeys,
  MAX_FAILED_ACTIVITY_ATTEMPTS,
} = loadEsmModule("../js/activity-memory.js");

describe("sanitizeActivityAttempts", () => {
  test("drops expand/see-more style keys (en + vi)", () => {
    const attempts = {
      "quiz of the day": 1,
      "see more": 2,
      "xem thêm": 1,
      "mở rộng": 3,
    };
    expect(sanitizeActivityAttempts(attempts)).toEqual({
      "quiz of the day": 1,
    });
  });

  test("returns empty object for nullish input", () => {
    expect(sanitizeActivityAttempts(null)).toEqual({});
    expect(sanitizeActivityAttempts(undefined)).toEqual({});
  });

  test("keeps real activity keys untouched", () => {
    const attempts = { "daily poll": 1, "news quiz": 2 };
    expect(sanitizeActivityAttempts(attempts)).toEqual(attempts);
  });
});

describe("sanitizeActivityConfirmed", () => {
  test("drops expand keys and normalizes values to true", () => {
    expect(
      sanitizeActivityConfirmed({
        "daily poll": true,
        "see more": true,
        "news quiz": 1,
      }),
    ).toEqual({ "daily poll": true, "news quiz": true });
  });

  test("drops falsey entries entirely", () => {
    expect(
      sanitizeActivityConfirmed({ a: false, b: 0, c: null, d: true }),
    ).toEqual({ d: true });
  });

  test("returns empty object for nullish input", () => {
    expect(sanitizeActivityConfirmed(null)).toEqual({});
  });
});

describe("migrateActivityMemory", () => {
  test("legacy attempts counted confirmations, so they become confirmed", () => {
    // Pre-split memory only ever incremented `attempts` on success. Reading it
    // as failures would hand every finished card a free retry.
    expect(
      migrateActivityMemory({ attempts: { "daily poll": 1, quiz: 2 } }),
    ).toEqual({
      confirmed: { "daily poll": true, quiz: true },
      attempts: {},
    });
  });

  test("keeps the two ledgers separate once confirmed exists", () => {
    expect(
      migrateActivityMemory({
        confirmed: { a: true },
        attempts: { b: 3 },
      }),
    ).toEqual({ confirmed: { a: true }, attempts: { b: 3 } });
  });

  test("an empty confirmed map is still treated as already migrated", () => {
    // {} is not undefined — the memory has been through the split and simply
    // has nothing confirmed yet, so `attempts` must keep its failure meaning.
    expect(
      migrateActivityMemory({ confirmed: {}, attempts: { b: 2 } }),
    ).toEqual({ confirmed: {}, attempts: { b: 2 } });
  });

  test("strips expand keys during migration", () => {
    expect(
      migrateActivityMemory({ attempts: { "see more": 1, ok: 1 } }),
    ).toEqual({ confirmed: { ok: true }, attempts: {} });
  });

  test("tolerates nullish/empty memory", () => {
    expect(migrateActivityMemory(null)).toEqual({
      confirmed: {},
      attempts: {},
    });
    expect(migrateActivityMemory({})).toEqual({ confirmed: {}, attempts: {} });
  });
});

describe("getBlockedActivityKeys", () => {
  test("blocks keys visited this session", () => {
    const blocked = getBlockedActivityKeys(
      { attempts: {} },
      new Set(["a", "b"]),
    );
    expect(blocked.has("a")).toBe(true);
    expect(blocked.has("b")).toBe(true);
  });

  test("blocks a card after a SINGLE confirmation", () => {
    // The whole point: a card that already paid out must never be clicked
    // again today — a second click costs a tab load and earns nothing.
    const blocked = getBlockedActivityKeys(
      { confirmed: { paid: true }, attempts: {} },
      new Set(),
    );
    expect(blocked.has("paid")).toBe(true);
  });

  test("blocks only once failures reach the daily cap", () => {
    const memory = {
      confirmed: {},
      attempts: {
        atCap: MAX_FAILED_ACTIVITY_ATTEMPTS,
        overCap: MAX_FAILED_ACTIVITY_ATTEMPTS + 2,
        underCap: MAX_FAILED_ACTIVITY_ATTEMPTS - 1,
      },
    };
    const blocked = getBlockedActivityKeys(memory, new Set());
    expect(blocked.has("atCap")).toBe(true);
    expect(blocked.has("overCap")).toBe(true);
    expect(blocked.has("underCap")).toBe(false);
  });

  test("a failing card survives more than one run before being given up on", () => {
    // Two failed runs must not exhaust the budget, otherwise a card whose
    // points merely register late is abandoned for the day.
    const memory = { confirmed: {}, attempts: { slow: 2 } };
    expect(getBlockedActivityKeys(memory, new Set()).has("slow")).toBe(false);
  });

  test("honours a custom failure threshold", () => {
    const memory = { confirmed: {}, attempts: { a: 2 } };
    expect(
      getBlockedActivityKeys(memory, new Set(), { maxFailedAttempts: 2 }).has(
        "a",
      ),
    ).toBe(true);
  });

  test("tolerates missing memory/session", () => {
    expect(getBlockedActivityKeys(null, null).size).toBe(0);
    expect(getBlockedActivityKeys(null, null, null).size).toBe(0);
  });
});

describe("recordActivityFailures", () => {
  test("increments failure counts, creating the map if needed", () => {
    const memory = {};
    recordActivityFailures(memory, ["a", "a", "b"]);
    expect(memory.attempts).toEqual({ a: 2, b: 1 });
  });

  test("is a no-op without a memory object", () => {
    expect(() => recordActivityFailures(null, ["a"])).not.toThrow();
  });
});

describe("confirmActivityKeys", () => {
  test("marks visited, clears misses, and confirms for the day", () => {
    const memory = { confirmed: {}, attempts: {} };
    const visited = new Set();
    const misses = new Map([["a", 1]]);
    confirmActivityKeys(memory, visited, misses, ["a"]);
    expect(visited.has("a")).toBe(true);
    expect(misses.has("a")).toBe(false);
    expect(memory.confirmed.a).toBe(true);
  });

  test("a success wipes the card's earlier failures", () => {
    // Those misses were slow points or a raced tab, not evidence of a dead
    // card — leaving them would push it toward the cap for no reason.
    const memory = { confirmed: {}, attempts: { a: 3 } };
    confirmActivityKeys(memory, new Set(), new Map(), ["a"]);
    expect(memory.attempts.a).toBeUndefined();
    expect(getBlockedActivityKeys(memory, new Set()).has("a")).toBe(true);
  });

  test("creates the confirmed map when missing", () => {
    const memory = {};
    confirmActivityKeys(memory, new Set(), new Map(), ["a"]);
    expect(memory.confirmed).toEqual({ a: true });
  });
});

describe("markUnconfirmedActivityKeys", () => {
  test("first miss is retryable, not yet blocked", () => {
    const visited = new Set();
    const misses = new Map();
    const result = markUnconfirmedActivityKeys(["a"], visited, misses);
    expect(result.retryable).toBe(true);
    expect(result.blocked).toBe(0);
    expect(visited.has("a")).toBe(false);
    expect(misses.get("a")).toBe(1);
  });

  test("a second miss stays retryable under the default threshold of 3", () => {
    const visited = new Set();
    const misses = new Map([["a", 1]]);
    const result = markUnconfirmedActivityKeys(["a"], visited, misses);
    expect(result.blocked).toBe(0);
    expect(result.retryable).toBe(true);
    expect(visited.has("a")).toBe(false);
  });

  test("reaching maxMisses blocks the key for the session", () => {
    const visited = new Set();
    const misses = new Map([["a", 2]]);
    const result = markUnconfirmedActivityKeys(["a"], visited, misses);
    expect(result.blocked).toBe(1);
    expect(visited.has("a")).toBe(true);
  });

  test("honours a custom maxMisses threshold", () => {
    const visited = new Set();
    const misses = new Map();
    markUnconfirmedActivityKeys(["a"], visited, misses, 1);
    expect(visited.has("a")).toBe(true);
  });

  test("only a session-level give-up costs a daily failure", () => {
    const memory = { confirmed: {}, attempts: {} };
    const visited = new Set();
    const misses = new Map();
    // Two in-session retries of the same attempt: nothing recorded yet.
    markUnconfirmedActivityKeys(["a"], visited, misses, 3, memory);
    markUnconfirmedActivityKeys(["a"], visited, misses, 3, memory);
    expect(memory.attempts.a).toBeUndefined();
    // The third miss gives up for the session, and that is what counts.
    markUnconfirmedActivityKeys(["a"], visited, misses, 3, memory);
    expect(memory.attempts.a).toBe(1);
  });

  test("failures persist across runs until the cap is reached", () => {
    const memory = { confirmed: {}, attempts: {} };
    for (let run = 1; run <= MAX_FAILED_ACTIVITY_ATTEMPTS; run++) {
      // Each run starts with a fresh session ledger, as service.js does.
      const visited = new Set();
      const misses = new Map();
      for (let i = 0; i < 3; i++) {
        markUnconfirmedActivityKeys(["a"], visited, misses, 3, memory);
      }
      expect(memory.attempts.a).toBe(run);
    }
    expect(getBlockedActivityKeys(memory, new Set()).has("a")).toBe(true);
  });

  test("works without a memory object (session-only behaviour)", () => {
    const visited = new Set();
    const misses = new Map([["a", 2]]);
    expect(() =>
      markUnconfirmedActivityKeys(["a"], visited, misses, 3, null),
    ).not.toThrow();
    expect(visited.has("a")).toBe(true);
  });
});

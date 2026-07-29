const { loadEsmModule } = require("./esm-loader.js");

const {
  findFirstNumberByKey,
  getCounterValue,
  pickActiveCounter,
  sumCounterProgress,
  buildRewardsSnapshot,
  getScoreDelta,
} = loadEsmModule("../js/rewards-metrics.js");

describe("findFirstNumberByKey", () => {
  test("finds a top-level numeric value by case-insensitive key", () => {
    expect(
      findFirstNumberByKey({ AvailablePoints: "42" }, ["availablePoints"]),
    ).toBe(42);
  });

  test("searches nested objects", () => {
    const src = { a: { b: { totalPoints: 100 } } };
    expect(findFirstNumberByKey(src, ["totalpoints"])).toBe(100);
  });

  test("returns null when no numeric match exists", () => {
    expect(findFirstNumberByKey({ foo: "bar" }, ["points"])).toBeNull();
  });

  test("skips non-finite values and keeps searching", () => {
    const src = { points: "not-a-number", nested: { points: 7 } };
    expect(findFirstNumberByKey(src, ["points"])).toBe(7);
  });

  test("does not loop forever on circular references", () => {
    const a = { name: "a" };
    a.self = a;
    expect(findFirstNumberByKey(a, ["missing"])).toBeNull();
  });
});

describe("getCounterValue", () => {
  test("reads value from attributes shape", () => {
    expect(getCounterValue([{ attributes: { progress: 3 } }], "progress")).toBe(
      3,
    );
  });

  test("reads value from flat shape", () => {
    expect(getCounterValue([{ progress: 5 }], "progress")).toBe(5);
  });

  test("returns 0 for empty or non-array input", () => {
    expect(getCounterValue([], "progress")).toBe(0);
    expect(getCounterValue(null, "progress")).toBe(0);
  });

  test("returns 0 when key missing", () => {
    expect(getCounterValue([{ attributes: {} }], "progress")).toBe(0);
  });

  test("reads the tier that still has room, not blindly the first entry", () => {
    const tiers = [
      { attributes: { progress: 30, max: 30 } },
      { attributes: { progress: 12, max: 90 } },
    ];
    expect(getCounterValue(tiers, "progress")).toBe(12);
    expect(getCounterValue(tiers, "max")).toBe(90);
  });

  test("falls back to the last tier when every tier is complete", () => {
    const tiers = [
      { attributes: { progress: 30, max: 30 } },
      { attributes: { progress: 90, max: 90 } },
    ];
    expect(getCounterValue(tiers, "progress")).toBe(90);
    expect(getCounterValue(tiers, "max")).toBe(90);
  });

  test("skips a null entry rather than reporting 0", () => {
    expect(getCounterValue([null, { progress: 7, max: 90 }], "progress")).toBe(
      7,
    );
  });
});

describe("pickActiveCounter", () => {
  test("returns null for empty or non-array input", () => {
    expect(pickActiveCounter([])).toBeNull();
    expect(pickActiveCounter(null)).toBeNull();
    expect(pickActiveCounter([null])).toBeNull();
  });

  test("returns the same entry that progress and max are read from", () => {
    const active = { attributes: { progress: 12, max: 90 } };
    expect(pickActiveCounter([{ progress: 30, max: 30 }, active])).toBe(active);
  });
});

describe("sumCounterProgress", () => {
  test("sums progress across counter arrays", () => {
    const counters = {
      pcSearch: [{ attributes: { progress: 30 } }],
      mobileSearch: [{ attributes: { progress: 20 } }],
    };
    expect(sumCounterProgress(counters)).toBe(50);
  });

  test("ignores non-array values", () => {
    expect(
      sumCounterProgress({ meta: "x", pcSearch: [{ progress: 10 }] }),
    ).toBe(10);
  });

  test("returns 0 for invalid input", () => {
    expect(sumCounterProgress(null)).toBe(0);
    expect(sumCounterProgress("nope")).toBe(0);
  });
});

describe("buildRewardsSnapshot", () => {
  test("prefers availablePoints as score", () => {
    const snap = buildRewardsSnapshot({
      availablePoints: 1200,
      lifetimePoints: 5000,
      counters: {
        pcSearch: [{ attributes: { progress: 30 } }],
        mobileSearch: [{ attributes: { progress: 10 } }],
      },
    });
    expect(snap.score).toBe(1200);
    expect(snap.pcProgress).toBe(30);
    expect(snap.mobProgress).toBe(10);
  });

  test("falls back to lifetimePoints then counterProgress", () => {
    expect(buildRewardsSnapshot({ lifetimePoints: 800 }).score).toBe(800);
    const counterOnly = buildRewardsSnapshot({
      counters: { pcSearch: [{ progress: 15 }] },
    });
    expect(counterOnly.score).toBe(15);
  });

  test("tolerates empty userStatus", () => {
    const snap = buildRewardsSnapshot({});
    expect(snap.pcProgress).toBe(0);
    expect(snap.mobProgress).toBe(0);
  });
});

describe("getScoreDelta", () => {
  test("returns positive delta when points increase", () => {
    expect(getScoreDelta({ score: 100 }, { score: 130 })).toBe(30);
  });

  test("returns null when either snapshot missing", () => {
    expect(getScoreDelta(null, { score: 1 })).toBeNull();
    expect(getScoreDelta({ score: 1 }, null)).toBeNull();
  });

  test("returns null when a score is not finite", () => {
    expect(getScoreDelta({ score: null }, { score: 5 })).toBeNull();
    expect(getScoreDelta({ score: 5 }, { score: NaN })).toBeNull();
  });
});

const { loadEsmModule } = require("./esm-loader.js");

const {
  DEFAULT_POINTS_PER_SEARCH,
  MAX_MAKEUP_SEARCHES,
  createSearchCreditGoal,
  isSearchCreditGoalReached,
  getSearchIterationLimit,
  shouldContinueSearch,
  assessSearchCheckpoint,
} = loadEsmModule("../js/search-credit.js");

describe("search credit goals", () => {
  test("targets the requested points without exceeding the daily maximum", () => {
    expect(
      createSearchCreditGoal(
        { pcProgress: 0, pcMax: 90 },
        "pcProgress",
        "pcMax",
        31,
      ),
    ).toMatchObject({ start: 0, target: 90, max: 90 });

    expect(
      createSearchCreditGoal(
        { pcProgress: 30, pcMax: 90 },
        "pcProgress",
        "pcMax",
        5,
      ),
    ).toMatchObject({ start: 30, target: 45 });
  });

  test("returns no goal when the Rewards counter is unavailable", () => {
    expect(createSearchCreditGoal({}, "pcProgress", "pcMax", 10)).toBeNull();
    expect(
      createSearchCreditGoal(
        { pcProgress: 0, pcMax: 0 },
        "pcProgress",
        "pcMax",
        10,
      ),
    ).toBeNull();
  });

  test("detects when the real counter reached its goal", () => {
    const goal = { target: 60 };
    expect(
      isSearchCreditGoalReached(goal, { mobProgress: 60 }, "mobProgress"),
    ).toBe(true);
    expect(
      isSearchCreditGoalReached(goal, { mobProgress: 57 }, "mobProgress"),
    ).toBe(false);
  });
});

describe("make-up search budget", () => {
  test("adds a bounded make-up allowance", () => {
    expect(getSearchIterationLimit(5)).toBe(9);
    expect(getSearchIterationLimit(20)).toBe(28);
    expect(getSearchIterationLimit(100)).toBe(100 + MAX_MAKEUP_SEARCHES);
  });

  test("runs the requested iterations before consulting the counter", () => {
    expect(
      shouldContinueSearch({
        attemptedIterations: 4,
        requestedSearches: 5,
        successfulSearches: 4,
        iterationLimit: 9,
        creditGoal: { target: 15 },
        snapshot: { pcProgress: 15 },
        counterField: "pcProgress",
      }),
    ).toBe(true);
  });

  test("adds make-up searches while the point target is short", () => {
    const base = {
      requestedSearches: 5,
      successfulSearches: 5,
      iterationLimit: 9,
      creditGoal: { target: 15 },
      counterField: "pcProgress",
    };
    expect(
      shouldContinueSearch({
        ...base,
        attemptedIterations: 5,
        snapshot: { pcProgress: 12 },
      }),
    ).toBe(true);
    expect(
      shouldContinueSearch({
        ...base,
        attemptedIterations: 6,
        snapshot: { pcProgress: 15 },
      }),
    ).toBe(false);
  });

  test("falls back to confirmed-search count without a Rewards snapshot", () => {
    expect(
      shouldContinueSearch({
        attemptedIterations: 5,
        requestedSearches: 5,
        successfulSearches: 4,
        iterationLimit: 9,
      }),
    ).toBe(true);
  });

  test("never exceeds the iteration limit", () => {
    expect(
      shouldContinueSearch({
        attemptedIterations: 9,
        requestedSearches: 5,
        successfulSearches: 0,
        iterationLimit: 9,
        creditGoal: { target: 15 },
        snapshot: { pcProgress: 0 },
        counterField: "pcProgress",
      }),
    ).toBe(false);
  });
});

describe("checkpoint assessment", () => {
  test("detects partial credit, not only a completely frozen counter", () => {
    expect(
      assessSearchCheckpoint({
        before: { pcProgress: 0 },
        after: { pcProgress: 3, pcMax: 90 },
        counterField: "pcProgress",
        counterMaxField: "pcMax",
        successfulSinceCheckpoint: 4,
      }),
    ).toMatchObject({
      progressed: 3,
      expected: 4 * DEFAULT_POINTS_PER_SEARCH,
      missingPoints: 9,
      quotaFull: false,
    });
  });

  test("recognizes a full quota", () => {
    expect(
      assessSearchCheckpoint({
        before: { mobProgress: 57 },
        after: { mobProgress: 60, mobMax: 60 },
        counterField: "mobProgress",
        counterMaxField: "mobMax",
        successfulSinceCheckpoint: 1,
      }).quotaFull,
    ).toBe(true);
  });
});

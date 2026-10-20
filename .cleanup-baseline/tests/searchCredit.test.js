const { loadEsmModule } = require("./esm-loader.js");

const {
  DEFAULT_POINTS_PER_SEARCH,
  createSearchCreditGoal,
  isSearchCreditGoalReached,
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

describe("exact plan size (no make-up)", () => {
  test("runs exactly the requested iterations and stops", () => {
    expect(
      shouldContinueSearch({ attemptedIterations: 4, requestedSearches: 5 }),
    ).toBe(true);
    expect(
      shouldContinueSearch({ attemptedIterations: 5, requestedSearches: 5 }),
    ).toBe(false);
  });

  test("counter state cannot extend the plan", () => {
    // A short point total, a lagging counter, or failed attempts inside the plan
    // must never buy extra iterations — the desk/mob counts on the form are
    // exact, and anything the caller passes beyond them is ignored by design.
    expect(
      shouldContinueSearch({
        attemptedIterations: 5,
        requestedSearches: 5,
        successfulSearches: 3,
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

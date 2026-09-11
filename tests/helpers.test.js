/**
 * Contract tests against the SHIPPED helper modules.
 * Imports the real files — no copies, no re-implementations, no mocks of
 * the unit under test.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeSearchPlan,
  hasSearchWork,
  toSearchCount,
} from "../js/search-plan.js";
import { isScheduledModeActive } from "../js/schedule-utils.js";
import { limitPlanForCompletedCounters } from "../js/daily-counters.js";
import {
  createSearchCreditGoal,
  isSearchCreditGoalReached,
  shouldContinueSearch,
  assessSearchCheckpoint,
  DEFAULT_POINTS_PER_SEARCH,
} from "../js/search-credit.js";
import { isCompleteSearchCount } from "../js/search-results.js";
import {
  pickActiveCounter,
  getCounterValue,
  buildRewardsSnapshot,
  getScoreDelta,
  isRewardsSearchCounterComplete,
  getRewardsSearchCounterDone,
} from "../js/rewards-metrics.js";
import {
  getRewardsSearchCounterDone as getRewardsSearchCounterDoneFromUtils,
  isRewardsSearchCounterComplete as isRewardsSearchCounterCompleteFromUtils,
} from "../js/utils.js";
import {
  MAX_FAILED_ACTIVITY_ATTEMPTS,
  migrateActivityMemory,
  getBlockedActivityKeys,
  confirmActivityKeys,
  markUnconfirmedActivityKeys,
  recordActivityFailures,
} from "../js/activity-memory.js";
import { shouldStopClaimPass } from "../js/activity-pass-utils.js";

describe("criterion 1: invalid counts are not remaining work", () => {
  it("toSearchCount floors and treats missing/NaN/sub-1 as 0", () => {
    assert.equal(toSearchCount(undefined), 0);
    assert.equal(toSearchCount(null), 0);
    assert.equal(toSearchCount(NaN), 0);
    assert.equal(toSearchCount("not-a-number"), 0);
    assert.equal(toSearchCount(0.4), 0);
    assert.equal(toSearchCount(0.9), 0);
    assert.equal(toSearchCount(-3), 0);
    assert.equal(toSearchCount(3.7), 3);
    assert.equal(toSearchCount("11"), 11);
  });

  it("hasSearchWork is false for missing, NaN, and sub-1 fractional counts", () => {
    assert.equal(hasSearchWork({}), false);
    assert.equal(hasSearchWork({ desk: undefined, mob: undefined }), false);
    assert.equal(hasSearchWork({ desk: NaN, mob: NaN }), false);
    assert.equal(hasSearchWork({ desk: 0.4, mob: 0 }), false);
    assert.equal(hasSearchWork({ desk: 0, mob: 0.9 }), false);
    assert.equal(hasSearchWork({ desk: "abc", mob: null }), false);
  });

  it("hasSearchWork is true only when a side floors to at least 1", () => {
    assert.equal(hasSearchWork({ desk: 1, mob: 0 }), true);
    assert.equal(hasSearchWork({ desk: 0, mob: 11 }), true);
    assert.equal(hasSearchWork({ desk: 1.2, mob: 0 }), true);
    assert.equal(hasSearchWork({ desk: 0, mob: 0 }), false);
  });

  it("normalizeSearchPlan stores floored non-negative integer counts", () => {
    const plan = normalizeSearchPlan({ desk: 0.4, mob: NaN, min: 6, max: 10 });
    assert.equal(plan.desk, 0);
    assert.equal(plan.mob, 0);
    assert.equal(hasSearchWork(plan), false);
  });

  it("periodic schedule modes are inactive when counts are missing/NaN/sub-1", () => {
    assert.equal(isScheduledModeActive(null), false);
    assert.equal(isScheduledModeActive(undefined), false);
    assert.equal(
      isScheduledModeActive({ mode: "m3", desk: undefined, mob: undefined }),
      false,
    );
    assert.equal(
      isScheduledModeActive({ mode: "m3", desk: NaN, mob: 0 }),
      false,
    );
    assert.equal(
      isScheduledModeActive({ mode: "m4", desk: 0.4, mob: 0.9 }),
      false,
    );
    assert.equal(
      isScheduledModeActive({ mode: "m3", desk: 0, mob: 0 }),
      false,
    );
  });

  it("periodic schedule modes are active when a count floors to at least 1", () => {
    assert.equal(
      isScheduledModeActive({ mode: "m3", desk: 11, mob: 0 }),
      true,
    );
    assert.equal(
      isScheduledModeActive({ mode: "m4", desk: 0, mob: 5 }),
      true,
    );
  });

  it("m1/m2/m5 stay inactive even with positive counts", () => {
    assert.equal(
      isScheduledModeActive({ mode: "m1", desk: 11, mob: 11 }),
      false,
    );
    assert.equal(
      isScheduledModeActive({ mode: "m2", desk: 11, mob: 11 }),
      false,
    );
    assert.equal(
      isScheduledModeActive({ mode: "m5", desk: 11, mob: 11 }),
      false,
    );
  });
});

describe("criterion 2: plan limiting, no makeup searches, complete only when confirmed meets requested", () => {
  it("zeros the completed side of the plan and leaves the other side", () => {
    const plan = { desk: 11, mob: 21, min: 6, max: 10 };
    const limited = limitPlanForCompletedCounters(plan, {
      pcDone: true,
      mobileDone: false,
    });
    assert.equal(limited.desk, 0);
    assert.equal(limited.mob, 21);
    assert.notEqual(limited, plan);
    assert.equal(plan.desk, 11);
  });

  it("zeros both sides when both counters are complete", () => {
    const limited = limitPlanForCompletedCounters(
      { desk: 11, mob: 21 },
      { pcDone: true, mobileDone: true },
    );
    assert.equal(hasSearchWork(limited), false);
  });

  it("does not extend the loop when the Rewards counter lags", () => {
    const requested = 10;
    const start = 0;
    const max = 90;
    const goal = createSearchCreditGoal(
      { pcProgress: start, pcMax: max },
      "pcProgress",
      "pcMax",
      requested,
      DEFAULT_POINTS_PER_SEARCH,
    );
    assert.ok(goal);
    assert.ok(
      goal.target <= start + requested * DEFAULT_POINTS_PER_SEARCH,
      "credit goal must not ask for more than requested * unit",
    );
    assert.ok(goal.target <= max);

    const lagging = { pcProgress: start, pcMax: max };
    assert.equal(
      isSearchCreditGoalReached(goal, lagging, "pcProgress"),
      false,
    );

    assert.equal(
      shouldContinueSearch({
        attemptedIterations: requested,
        requestedSearches: requested,
      }),
      false,
    );
    assert.equal(
      shouldContinueSearch({
        attemptedIterations: requested - 1,
        requestedSearches: requested,
      }),
      true,
    );
  });

  it("shouldContinueSearch does not treat sub-1 fractional requested as work", () => {
    assert.equal(
      shouldContinueSearch({
        attemptedIterations: 0,
        requestedSearches: 0.4,
      }),
      false,
    );
    assert.equal(
      shouldContinueSearch({
        attemptedIterations: 0,
        requestedSearches: NaN,
      }),
      false,
    );
  });

  it("a search phase is complete only when confirmed searches meet the requested count", () => {
    assert.equal(isCompleteSearchCount(10, 10), true);
    assert.equal(isCompleteSearchCount(11, 10), true);
    assert.equal(isCompleteSearchCount(9, 10), false);
    assert.equal(isCompleteSearchCount(0, 10), false);
    assert.equal(isCompleteSearchCount(0, 0), false);
    assert.equal(isCompleteSearchCount(3, 0.4), false);
    assert.equal(isCompleteSearchCount(NaN, 10), false);
  });

  it("quotaFull is true only when a live max is finite and current meets it", () => {
    const full = assessSearchCheckpoint({
      before: { pcProgress: 27, pcMax: 30 },
      after: { pcProgress: 30, pcMax: 30 },
      counterField: "pcProgress",
      counterMaxField: "pcMax",
      successfulSinceCheckpoint: 1,
    });
    assert.equal(full.quotaFull, true);

    const missing = assessSearchCheckpoint({
      before: {},
      after: {},
      counterField: "pcProgress",
      counterMaxField: "pcMax",
      successfulSinceCheckpoint: 1,
    });
    assert.equal(missing.quotaFull, false);
  });
});

describe("criterion 3: live tier, aliases, missing ≠ 0/0, shared-metric delta", () => {
  const aliasComplete = {
    pointProgress: 30,
    pointProgressMax: 30,
  };
  const aliasLive = {
    currentProgress: 12,
    maxProgress: 60,
  };
  const standardComplete = { progress: 10, max: 10 };
  const standardLive = { progress: 18, max: 60 };

  it("pickActiveCounter prefers the still-incomplete tier", () => {
    const picked = pickActiveCounter([standardComplete, standardLive]);
    assert.equal(getCounterValue([standardComplete, standardLive], "progress"), 18);
    assert.equal(getCounterValue([standardComplete, standardLive], "max"), 60);
    assert.equal(picked.progress, 18);
  });

  it("honors progress/max aliases on the live tier", () => {
    const counters = {
      pcSearch: [aliasComplete, aliasLive],
    };
    assert.equal(getCounterValue(counters.pcSearch, "progress"), 12);
    assert.equal(getCounterValue(counters.pcSearch, "max"), 60);
    assert.equal(isRewardsSearchCounterComplete(counters.pcSearch), false);
    assert.equal(getRewardsSearchCounterDone(counters, "pcSearch"), 0);
  });

  it("alias-only completed counters count as done", () => {
    const counters = {
      pcSearch: [{ current: 90, total: 90 }],
      mobileSearch: [{ pointProgress: 60, pointProgressMax: 60 }],
    };
    assert.equal(isRewardsSearchCounterComplete(counters.pcSearch), true);
    assert.equal(getRewardsSearchCounterDone(counters, "pcSearch"), 1);
    assert.equal(getRewardsSearchCounterDone(counters, "mobileSearch"), 1);
  });

  it("reads aliased fields from item.attributes", () => {
    const arr = [
      {
        attributes: {
          currentProgress: 4,
          maxProgress: 30,
        },
      },
    ];
    assert.equal(getCounterValue(arr, "progress"), 4);
    assert.equal(getCounterValue(arr, "max"), 30);
    assert.equal(isRewardsSearchCounterComplete(arr), false);
  });

  it("does not treat a missing counter as 0/0 quota-full or already-done", () => {
    assert.equal(isRewardsSearchCounterComplete(undefined), false);
    assert.equal(isRewardsSearchCounterComplete(null), false);
    assert.equal(isRewardsSearchCounterComplete([]), false);
    assert.equal(getRewardsSearchCounterDone({}, "pcSearch"), 0);
    assert.equal(getCounterValue(undefined, "progress"), null);
    assert.equal(getCounterValue(undefined, "max"), null);

    const snapshot = buildRewardsSnapshot({ availablePoints: 120 });
    assert.equal(snapshot.pcProgress, null);
    assert.equal(snapshot.pcMax, null);
    assert.equal(snapshot.mobProgress, null);
    assert.equal(snapshot.mobMax, null);
    assert.equal(snapshot.availablePoints, 120);
  });

  it("0/0 described counters are not complete (no quota)", () => {
    assert.equal(
      isRewardsSearchCounterComplete([{ progress: 0, max: 0 }]),
      false,
    );
  });

  it("when every tier is complete, the last described max wins", () => {
    const arr = [
      { progress: 10, max: 10 },
      { progress: 30, max: 30 },
    ];
    assert.equal(getCounterValue(arr, "progress"), 30);
    assert.equal(getCounterValue(arr, "max"), 30);
    assert.equal(isRewardsSearchCounterComplete(arr), true);
  });

  it("utils.js and rewards-metrics.js agree on complete/done", () => {
    const samples = [
      { pcSearch: [standardLive] },
      { pcSearch: [{ current: 90, total: 90 }] },
      { pcSearch: [aliasComplete, aliasLive] },
      { pcSearch: [standardComplete, standardLive] },
      {},
      { pcSearch: [] },
    ];
    for (const counters of samples) {
      assert.equal(
        getRewardsSearchCounterDone(counters, "pcSearch"),
        getRewardsSearchCounterDoneFromUtils(counters, "pcSearch"),
      );
      assert.equal(
        isRewardsSearchCounterComplete(counters.pcSearch),
        isRewardsSearchCounterCompleteFromUtils(counters.pcSearch),
      );
    }
  });

  it("getScoreDelta uses a metric finite on both snapshots, not mixed collapsed scores", () => {
    assert.equal(
      getScoreDelta(
        { availablePoints: 100, score: 100 },
        { availablePoints: 103, score: 103 },
      ),
      3,
    );
    assert.equal(
      getScoreDelta({ score: 10 }, { score: 14 }),
      4,
    );
    assert.equal(
      getScoreDelta(
        { availablePoints: 100, score: 100 },
        { lifetimePoints: 5000, score: 5000 },
      ),
      null,
    );
    assert.equal(getScoreDelta(null, { score: 1 }), null);
    assert.equal(
      getScoreDelta(
        { lifetimePoints: 200, score: 200 },
        { lifetimePoints: 206, score: 206 },
      ),
      6,
    );
  });

  it("buildRewardsSnapshot reads aliased live-tier counters", () => {
    const snapshot = buildRewardsSnapshot({
      availablePoints: 250,
      counters: {
        pcSearch: [aliasComplete, aliasLive],
        mobileSearch: [{ current: 60, total: 60 }],
      },
    });
    assert.equal(snapshot.pcProgress, 12);
    assert.equal(snapshot.pcMax, 60);
    assert.equal(snapshot.mobProgress, 60);
    assert.equal(snapshot.mobMax, 60);
    assert.equal(snapshot.availablePoints, 250);
  });
});

describe("criterion 4: activity memory ledgers and claim-pass stop", () => {
  it("blocks confirmed and max-failed keys", () => {
    const memory = {
      confirmed: { "quiz|done-card": true, "quiz|unconfirmed": false },
      attempts: {
        "quiz|broken": MAX_FAILED_ACTIVITY_ATTEMPTS,
        "quiz|retryable": MAX_FAILED_ACTIVITY_ATTEMPTS - 1,
      },
    };
    const blocked = getBlockedActivityKeys(memory, ["quiz|session"]);
    assert.equal(blocked.has("quiz|session"), true);
    assert.equal(blocked.has("quiz|done-card"), true);
    assert.equal(blocked.has("quiz|broken"), true);
    assert.equal(blocked.has("quiz|unconfirmed"), false);
    assert.equal(blocked.has("quiz|retryable"), false);
  });

  it("drops expand/see-more control keys from both ledgers and from the block set", () => {
    const migrated = migrateActivityMemory({
      confirmed: {
        "see more": true,
        "quiz|See More": true,
        "quiz|real": true,
        "earn more points when your friends search on Bing": true,
      },
      attempts: {
        "show more": 4,
        "quiz|broken": 4,
      },
    });
    assert.equal(migrated.confirmed["see more"], undefined);
    assert.equal(migrated.confirmed["quiz|See More"], undefined);
    assert.equal(migrated.confirmed["quiz|real"], true);
    assert.equal(
      migrated.confirmed["earn more points when your friends search on Bing"],
      true,
    );
    assert.equal(migrated.attempts["show more"], undefined);
    assert.equal(migrated.attempts["quiz|broken"], 4);

    const memory = {
      confirmed: { "see more": true, "quiz|kept": true },
      attempts: { "view all": 9, "quiz|dead": 9 },
    };
    const blocked = getBlockedActivityKeys(memory, []);
    assert.equal(blocked.has("see more"), false);
    assert.equal(blocked.has("view all"), false);
    assert.equal(blocked.has("quiz|kept"), true);
    assert.equal(blocked.has("quiz|dead"), true);

    const sessionVisited = new Set();
    const sessionMisses = new Set();
    const written = { confirmed: {}, attempts: {} };
    confirmActivityKeys(written, sessionVisited, sessionMisses, [
      "see more",
      "quiz|See More",
      "quiz|scored",
    ]);
    assert.equal(written.confirmed["see more"], undefined);
    assert.equal(written.confirmed["quiz|See More"], undefined);
    assert.equal(written.confirmed["quiz|scored"], true);
    assert.equal(sessionVisited.has("see more"), false);
    assert.equal(sessionVisited.has("quiz|scored"), true);

    recordActivityFailures(written, ["show more", "quiz|miss"]);
    assert.equal(written.attempts["show more"], undefined);
    assert.equal(written.attempts["quiz|miss"], 1);

    const missVisited = new Set();
    const missCounts = new Map();
    markUnconfirmedActivityKeys(
      ["expand", "quiz|slow"],
      missVisited,
      missCounts,
      1,
      written,
    );
    assert.equal(missVisited.has("expand"), false);
    assert.equal(missVisited.has("quiz|slow"), true);
  });

  it("stops a claim pass after a positive point delta even if retry is set", () => {
    assert.equal(
      shouldStopClaimPass({
        clicked: [{ text: "Confirm" }],
        count: 1,
        pointDelta: 10,
        retry: true,
      }),
      true,
    );
    assert.equal(
      shouldStopClaimPass({
        clicked: [{ text: "Confirm" }],
        count: 1,
        pointDelta: 0,
        retry: true,
      }),
      false,
    );
    assert.equal(
      shouldStopClaimPass({
        clicked: [{ text: "Confirm" }],
        count: 1,
        pointDelta: -1,
        retry: false,
      }),
      false,
    );
  });
});

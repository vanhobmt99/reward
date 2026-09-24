import { applyQuotaCooldown } from "../js/search-quota.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import {
  getRemainingSearches,
  getSearchCheckpointInterval,
  limitPlanForRemainingQuota,
  createSearchCreditGoal,
  shouldContinueSearch,
} from "../js/search-credit.js";
import { normalizeSearchPlan } from "../js/search-plan.js";
import { limitPlanForCompletedCounters } from "../js/daily-counters.js";

test("only plans the missing PC/mobile quota within the user's cap", () => {
  const plan = { desk: 31, mob: 21, min: 6, max: 10 };
  const snapshot = { pcProgress: 144, pcMax: 150, mobProgress: 99, mobMax: 100 };
  assert.deepEqual(limitPlanForRemainingQuota(plan, snapshot),
    { desk: 2, mob: 1, min: 6, max: 10 });
  assert.equal(plan.desk, 31);
  assert.equal(limitPlanForRemainingQuota({ desk: 1, mob: 0 }, snapshot).desk, 1);
  assert.equal(limitPlanForRemainingQuota({ desk: 1, mob: 0 }, snapshot).mob, 0);
});

test("full quota requires no searches and partial points round up", () => {
  for (const progress of [150, 151]) {
    assert.equal(getRemainingSearches({ p: progress, m: 150 }, "p", "m"), 0);
  }
  assert.equal(getRemainingSearches({ p: 146, m: 150 }, "p", "m"), 2);
  assert.equal(getRemainingSearches({ p: 140, m: 150 }, "p", "m", 5), 2);
});

test("missing, null, invalid and zero quota stay unknown", () => {
  for (const snapshot of [null, {}, { p: null, m: 150 }, { p: "", m: 150 },
    { p: NaN, m: 150 }, { p: -1, m: 150 }, { p: 0, m: 0 }]) {
    assert.equal(getRemainingSearches(snapshot, "p", "m"), null);
  }
});

test("checks each search near quota instead of waiting for a batch", () => {
  assert.equal(getSearchCheckpointInterval({ p: 138, m: 150 }, "p", "m"), 1);
  assert.equal(getSearchCheckpointInterval({ p: 144, m: 150 }, "p", "m"), 1);
  assert.equal(getSearchCheckpointInterval({ p: 0, m: 150 }, "p", "m"), 4);
});

test("service planner uses fresh partial quota and ignores stale snapshots", () => {
  const source = readFileSync(new URL("../js/service.js", import.meta.url), "utf8");
  const start = source.indexOf("function limitSearchPlanForToday(");
  const end = source.indexOf("function hasActivityQuota()", start);
  const context = vm.createContext({
    normalizeSearchPlan, limitPlanForCompletedCounters, limitPlanForRemainingQuota, applyQuotaCooldown,
    hasFreshSearchCounters: () => true,
    isDailySearchCounterDone: value => value >= 1,
    config: { runtime: { pcSearch: 0, mobileSearch: 0 } },
    liveSearchQuota: { pcProgress: 144, pcMax: 150, mobProgress: 90, mobMax: 90 },
    liveSearchQuotaAt: Date.now(), logs: false,
  });
  vm.runInContext(source.slice(start, end), context);
  const plan = vm.runInContext("limitSearchPlanForToday({desk:31,mob:21})", context);
  assert.equal(plan.desk, 2);
  assert.equal(plan.mob, 0);
  context.liveSearchQuotaAt = Date.now() - 180_000;
  assert.equal(vm.runInContext("limitSearchPlanForToday({desk:31,mob:21}).desk", context), 31);
});

test("actual search phase exits before sending queries for full or unknown quota", async () => {
  const source = readFileSync(new URL("../js/service.js", import.meta.url), "utf8");
  const start = source.indexOf("async function search(searches,");
  const end = source.indexOf("async function waitForUrl(", start);
  for (const [snapshot, expected] of [
    [{ pcProgress: 150, pcMax: 150 }, true],
    [{ pcProgress: null, pcMax: 150 }, false],
  ]) {
    let cancelled = false;
    const config = { runtime: { running: 1, mobile: 0, total: 31,
      requestedPlan: { desk: 31, mob: 0 }, rsaTab: 1 }, control: {} };
    const context = vm.createContext({
      config, navigator: { onLine: true }, logs: false,
      deferSearchQuota: () => {},
      defaultSearchDelayMin: 6, defaultSearchDelayMax: 10, minimumSearchDelay: 5,
      shortestDelay: 1000, bing: "https://www.bing.com/",
      getTabUrl: async () => "https://www.bing.com/",
      delay: async () => {}, set: async () => {}, saveRunCheckpoint: async () => {},
      startSearchKeepalive: () => () => { cancelled = true; },
      searchKeepaliveCancel: null, planLongPauseIndices: () => new Set(),
      ignoreDailyQuota: false, getRemainingSearches,
      fetchRewardsSnapshot: async () => snapshot,
      markRuntimeAction: (_action, extra) => Object.assign(config.runtime, extra),
      RUN_OUTCOMES: { UNCERTAIN: "uncertain" },
      // Deliberately omit query/perform: either being called fails this test.
    });
    vm.runInContext(source.slice(start, end), context);
    assert.equal(await vm.runInContext("search(31, 6, 10)", context), expected);
    assert.equal(cancelled, true);
    if (expected) assert.equal(config.runtime.total, 0);
    else assert.equal(config.runtime.outcomeReason, "quota_unavailable");
  }
});

test("actual search phase trims its persisted plan before the first query", async () => {
  const source = readFileSync(new URL("../js/service.js", import.meta.url), "utf8");
  const start = source.indexOf("async function search(searches,");
  const end = source.indexOf("async function waitForUrl(", start);
  const config = { runtime: { running: 1, mobile: 0, total: 52,
    requestedPlan: { desk: 31, mob: 21 }, rsaTab: 1 }, control: {} };
  const navigator = { onLine: true };
  const context = vm.createContext({
    config, navigator, logs: false,
    defaultSearchDelayMin: 6, defaultSearchDelayMax: 10, minimumSearchDelay: 5,
    shortestDelay: 1000, bing: "https://www.bing.com/",
    getTabUrl: async () => "https://www.bing.com/", delay: async () => {},
    set: async () => {}, saveRunCheckpoint: async () => { navigator.onLine = false; },
    startSearchKeepalive: () => () => {}, searchKeepaliveCancel: null,
    planLongPauseIndices: () => new Set(), ignoreDailyQuota: false,
    getRemainingSearches, createSearchCreditGoal, shouldContinueSearch,
    fetchRewardsSnapshot: async () => ({ pcProgress: 144, pcMax: 150 }),
    markRuntimeAction: () => {},
  });
  vm.runInContext(source.slice(start, end), context);
  await vm.runInContext("search(31, 6, 10)", context);
  assert.equal(config.runtime.requestedPlan.desk, 2);
  assert.equal(config.runtime.requestedPlan.mob, 21);
  assert.equal(config.runtime.total, 23);
});

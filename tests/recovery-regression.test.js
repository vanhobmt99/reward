import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createRunCoordinator } from "../js/run-coordinator.js";
import { cleanupAfterRun } from "../js/search-phases.js";
import { createRunCheckpoint, validateRunCheckpoint, getCheckpointRemainingPlan } from "../js/run-checkpoint.js";
import { startActivityDeadline } from "../js/run-deadline.js";
import { getConfirmedActivityKeys, collectPendingOffers } from "../js/activity-offers.js";
import { createQuotaSnapshot, createQuotaView, applyQuotaCooldown } from "../js/search-quota.js";
import { buildRewardsSnapshot } from "../js/rewards-metrics.js";
import { createPopupRunViewModel } from "../js/popup-view-model.js";
import { createDashboardActivityScript, createEarnActivityScript, createClaimReadyScript } from "../js/injected-scripts.js";

test("Stop twice retains ownership until cleanup and persistence finish", async () => {
  const config = { runtime: {} };
  let release;
  const coordinator = createRunCoordinator({ getConfig: () => config,
    setConfig: () => new Promise(resolve => { release = resolve; }) });
  const old = coordinator.startNewSession("search");
  coordinator.requestStop(); coordinator.requestStop();
  assert.equal(config.runtime.currentSession.id, old.id);
  assert.equal(coordinator.canStartNewRun().allowed, false);
  const cleanup = coordinator.stopCurrentSession("done", old.id);
  assert.equal(coordinator.canStartNewRun().allowed, false);
  release(); await cleanup;
  const next = coordinator.startNewSession("search");
  await coordinator.stopCurrentSession("late callback", old.id);
  assert.equal(config.runtime.currentSession.id, next.id);
});

test("late cleanup cannot close a new run's tab or change its badge", async () => {
  const touches = [];
  await cleanupAfterRun(10, "old", {
    isActiveSession: () => false,
    removeTabFn: async () => touches.push("tab"),
    clearBadgeFn: async () => touches.push("badge"),
  });
  assert.deepEqual(touches, []);
});

test("cleanup releases ownership even if rearming the alarm fails", async () => {
  let released = false;
  await assert.rejects(cleanupAfterRun(null, "same", {
    isActiveSession: () => true, setConfig: async () => {},
    getConfig: () => ({ runtime: { currentSession: { type: "schedule" } }, schedule: {} }),
    stopCurrentSession: async () => { released = true; },
    isScheduledModeActive: () => true, getScheduleAlarmDelayMs: () => 1000,
    createAlarm: async () => { throw new Error("alarm unavailable"); }, log: () => {},
  }), /alarm unavailable/);
  assert.equal(released, true);
});

test("checkpoint tracks early-full desktop separately and rejects unsafe recovery", () => {
  const checkpoint = createRunCheckpoint({ sessionId: "run", accountKey: "hash",
    requested: { desk: 10, mob: 5 },
    progress: { desk: { attempted: 2, finished: true }, mob: { attempted: 3 } },
    deadlines: { startedAt: 1000, deadlineAt: 9000, activityDeadlineAt: 8000 }, updatedAt: 2000 });
  assert.deepEqual(getCheckpointRemainingPlan(checkpoint), { desk: 0, mob: 2 });
  assert.equal(validateRunCheckpoint(checkpoint, { now: 3000, accountKey: "hash" }).valid, true);
  for (const accountKey of [null, undefined, "other"]) {
    assert.equal(validateRunCheckpoint(checkpoint, { now: 3000, accountKey }).valid, false);
  }
  assert.equal(validateRunCheckpoint({ ...checkpoint, status: "finished" }, { now: 3000, accountKey: "hash" }).valid, false);
  assert.equal(validateRunCheckpoint(checkpoint, { now: 9000, accountKey: "hash" }).reason, "deadline_exceeded");
  assert.equal(startActivityDeadline(checkpoint, 5000), 8000);
});

test("task confirmation requires the exact completed offer, not disappearance or balance", () => {
  const key = "keep-earning|one";
  const pending = { offerId: "one", destinationUrl: "https://bing.com/search?q=x", pointProgress: 0, pointProgressMax: 5 };
  for (const payload of [{}, { balance: 500 }, { morePromotions: [pending] }]) {
    assert.deepEqual(getConfirmedActivityKeys(payload, [key]), []);
  }
  assert.deepEqual(getConfirmedActivityKeys({ morePromotions: [{ ...pending, complete: true }] }, [key, "keep-earning|two"]), [key]);
  assert.deepEqual(collectPendingOffers({ dailySetPromotions: { "1/1/2000": [pending] } }), []);
});

test("quota preserves unknown values, freshness, caps and independent cooldowns", () => {
  const snapshot = buildRewardsSnapshot({ counters: { pcSearch: [{ progress: null, max: 150 }] } });
  assert.equal(snapshot.pcProgress, null);
  const searchQuota = createQuotaSnapshot({ pcProgress: 144, pcMax: 150, mobProgress: 90, mobMax: 90, account: "private" }, 1000);
  assert.equal("account" in searchQuota, false);
  const config = { searchQuota, search: { desk: 31, mob: 21 } };
  assert.equal(createQuotaView(config, 2000).rows[0].estimate, 2);
  assert.equal(createQuotaView(config, 200000).rows[0].estimate, null);
  assert.deepEqual(applyQuotaCooldown({ desk: 2, mob: 1 }, { desk: 10000 }, 2000), { desk: 0, mob: 1 });
});

test("activity-only history shows tasks and stop reason without 0/0 searches", () => {
  const view = createPopupRunViewModel({ runReports: [{ total: 0, tasks: { completed: 2, uncertain: 1 }, result: { outcome: "uncertain", reason: "quota_unavailable" } }] });
  assert.match(view.report.detail, /2 nhiệm vụ xong/);
  assert.match(view.report.detail, /Chưa đọc được quota/);
  assert.doesNotMatch(view.report.detail, /0\/0/);
});

test("injected scanners fail closed without recognized sections; claim probe never clicks", () => {
  const root = { querySelectorAll: () => [], querySelector: () => null, scrollHeight: 0 };
  const context = { document: { body: root, documentElement: root, querySelector: () => null, querySelectorAll: () => [] },
    window: { scrollY: 0, innerHeight: 700 }, location: { href: "https://rewards.bing.com/" } };
  for (const script of [createDashboardActivityScript([], 1, true), createEarnActivityScript([], 1, true)]) {
    const result = vm.runInNewContext(script, context);
    assert.equal(result.clicked.length, 0);
    assert.match(result.reason, /section unavailable/);
  }
  const result = vm.runInNewContext(createClaimReadyScript(true, false, true), context);
  assert.equal(result.clicked, false);
  assert.equal(result.count, null);
});

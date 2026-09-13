import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import * as schedule from "../js/schedule-utils.js";
import { hasSearchWork } from "../js/search-plan.js";

// Execute the shipped handlers and scheduling functions unchanged. Only the
// browser, persistence, Rewards API and search engine boundaries are doubles.
// This verifies dispatch to initialise, not a live Bing search or Chrome startup.
const source = readFileSync(new URL("../js/service.js", import.meta.url), "utf8");
function section(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `Missing source boundaries: ${start}`);
  return source.slice(a, b);
}
function harness(mode, options = {}) {
  const calls = [], alarms = new Map(), handlers = {}, crashes = [];
  const config = { schedule: { mode, desk: 1, mob: 0, time: "08:00", ...options.plan }, runtime: {} };
  const context = vm.createContext({
    config, logs: true, longestDelay: 15000, hasSearchWork,
    ...schedule,
    isScheduleModeActive: schedule.isScheduledModeActive,
    chrome: {
      alarms: {
        get: async name => alarms.get(name),
        create: async (name, value) => alarms.set(name, value),
        clear: async name => alarms.delete(name),
        onAlarm: { addListener: fn => { handlers.alarm = fn; } },
      },
      runtime: { onStartup: { addListener: fn => { handlers.startup = fn; } } },
    },
    get: async () => config,
    applyStoredConfig: async () => {},
    set: async () => calls.push("persist"),
    delay: async (ms, interruptible) => calls.push({ delay: ms, interruptible }),
    log: message => calls.push(message),
    recordCrash: (...args) => crashes.push(args),
    refreshSearchCountersFromRewards: async () => options.counters !== false,
    limitSearchPlanForToday: plan => options.complete ? { desk: 0, mob: 0 } : plan,
    hasActivityWork: () => Boolean(options.activity),
    RunCoordinator: {
      canStartNewRun: () => ({ allowed: !options.busy }),
      startNewSession: () => options.sessionFailure ? null : { id: "test-session" },
    },
    initialise: async (...args) => { calls.push({ initialise: args }); return true; },
  });
  vm.runInContext(section("function isScheduledModeActive()", "// Notify the user"), context);
  // The function ends before the next top-level declaration; no copied logic.
  const ensureStart = source.indexOf("async function ensureAlarms()");
  const ensureEnd = source.indexOf("\n}", ensureStart) + 2;
  vm.runInContext(source.slice(ensureStart, ensureEnd), context);
  vm.runInContext(section("async function tryStartScheduledRun(", "function chromeStorageGet("), context);
  vm.runInContext(section("chrome.alarms.onAlarm.addListener", "chrome.runtime.onInstalled.addListener"), context);
  vm.runInContext(section("chrome.runtime.onStartup.addListener", "chrome.runtime.onMessage.addListener"), context);
  return { calls, alarms, handlers, crashes, runs: () => calls.filter(x => x?.initialise), ensure: () => vm.runInContext("ensureAlarms()", context) };
}

for (const mode of ["m1", "m2", "m3", "m4", "m5"]) {
  test(`startup ${mode}: dispatches only the configured startup/periodic modes`, async () => {
    const h = harness(mode);
    await h.handlers.startup();
    assert.equal(h.runs().length, ["m2", "m3", "m4"].includes(mode) ? 1 : 0);
    assert.equal(h.crashes.length, 0);
    if (h.runs().length) {
      assert.ok(h.calls.some(x => x?.delay === 15000 && x.interruptible === false));
      assert.equal(h.runs()[0].initialise[2].notifyOnFinish, true);
    }
  });
}
for (const mode of ["m2", "m3", "m4", "m5"]) {
  for (const [label, options] of Object.entries({
    "Rewards unavailable": { counters: false },
    "quota complete": { complete: true },
    "another run active": { busy: true },
    "session refused": { sessionFailure: true },
    "zero searches": { plan: { desk: 0, mob: 0 } },
  })) {
    test(`${mode} prevents search when ${label}`, async () => {
      const h = harness(mode, options);
      if (mode === "m5") await h.handlers.alarm({ name: "schedule_daily", scheduledTime: Date.now() });
      else await h.handlers.startup();
      assert.equal(h.runs().length, 0);
      assert.equal(h.crashes.length, 0);
    });
  }
}
for (const mode of ["m3", "m4"]) {
  test(`${mode}: alarm starts work and unavailable counters re-arm a retry`, async () => {
    const h = harness(mode);
    await h.handlers.alarm({ name: "schedule" });
    assert.equal(h.runs().length, 1);
    const failed = harness(mode, { counters: false });
    await failed.handlers.alarm({ name: "schedule" });
    assert.ok(failed.alarms.get("schedule").when > Date.now());
    assert.equal(failed.crashes.length, 0);
  });
}
for (const mode of ["m1", "m2", "m5"]) {
  test(`${mode}: stale periodic alarm cannot trigger a run`, async () => {
    const h = harness(mode);
    h.alarms.set("schedule", {});
    await h.handlers.alarm({ name: "schedule" });
    assert.equal(h.runs().length, 0);
    assert.equal(h.alarms.has("schedule"), false);
  });
}
test("daily alarm: on time and 9 minutes late run; 11 minutes late is skipped", async () => {
  for (const [minutes, runs] of [[0, 1], [9, 1], [11, 0]]) {
    const h = harness("m5");
    await h.handlers.alarm({ name: "schedule_daily", scheduledTime: Date.now() - minutes * 60000 });
    assert.equal(h.runs().length, runs);
    assert.equal(h.crashes.length, 0);
  }
});
test("worker restart restores missing daily alarm without launching searches or resetting existing alarm", async () => {
  const h = harness("m5");
  await h.ensure();
  const alarm = h.alarms.get("schedule_daily");
  assert.ok(alarm.when > Date.now());
  assert.equal(alarm.periodInMinutes, 1440);
  await h.ensure();
  assert.equal(h.alarms.get("schedule_daily"), alarm);
  assert.equal(h.runs().length, 0);
});
test("startup-only mode never starts from counter reset alarms", async () => {
  const h = harness("m2");
  await h.handlers.alarm({ name: "clear" });
  await h.handlers.alarm({ name: "clear_afternoon" });
  assert.equal(h.runs().length, 0);
  assert.equal(h.crashes.length, 0);
});

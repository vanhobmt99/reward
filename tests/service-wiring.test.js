/**
 * Structural check: the service worker still calls the shipped helpers
 * rather than a parallel inlined copy that can drift.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const service = readFileSync(join(root, "js", "service.js"), "utf8");

describe("js/service.js still uses the shipped helpers", () => {
  const required = [
    { name: "hasSearchWork", from: "/js/search-plan.js" },
    { name: "normalizeSearchPlan", from: "/js/search-plan.js" },
    { name: "isScheduledModeActive", from: "/js/schedule-utils.js" },
    { name: "limitPlanForCompletedCounters", from: "/js/daily-counters.js" },
    { name: "getRewardsSearchCounterDone", from: "/js/utils.js" },
    { name: "isDailySearchCounterDone", from: "/js/utils.js" },
    { name: "buildRewardsSnapshot", from: "/js/rewards-metrics.js" },
    { name: "getScoreDelta", from: "/js/rewards-metrics.js" },
    { name: "getBlockedActivityKeys", from: "/js/activity-memory.js" },
    { name: "confirmActivityKeys", from: "/js/activity-memory.js" },
    { name: "shouldStopClaimPass", from: "/js/activity-pass-utils.js" },
    { name: "createSearchCreditGoal", from: "/js/search-credit.js" },
    { name: "shouldContinueSearch", from: "/js/search-credit.js" },
    { name: "isCompleteSearchCount", from: "/js/search-results.js" },
    { name: "isTabGoneError", from: "/js/tab-errors.js" },
    { name: "listenForTabGone", from: "/js/tab-errors.js" },
    { name: "classifyAutomaticTask", from: "/js/activity-policy.js" },
    { name: "createRunDeadlines", from: "/js/run-deadline.js" },
    { name: "createRunCheckpoint", from: "/js/run-checkpoint.js" },
    { name: "createRunResult", from: "/js/run-results.js" },
  ];

  for (const { name, from } of required) {
    it(`imports ${name} from ${from}`, () => {
      assert.match(service, new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(service, new RegExp(`\\b${name}\\b`));
    });
  }

  it("limits the plan with completed counters and hasSearchWork", () => {
    assert.match(service, /limitPlanForCompletedCounters\(/);
    assert.match(service, /hasSearchWork\(/);
    assert.match(service, /isDailySearchCounterDone\(/);
    assert.match(service, /getRewardsSearchCounterDone\(/);
  });

  it("stops claim passes with shouldStopClaimPass and records via confirmActivityKeys", () => {
    assert.match(service, /shouldStopClaimPass\(/);
    assert.match(service, /getBlockedActivityKeys\(/);
    assert.match(service, /confirmActivityKeys\(/);
    assert.match(service, /getScoreDelta\(/);
  });

  it("wait and waitForUrl both subscribe to tab removal via listenForTabGone", () => {
    assert.ok(service.includes("async function wait("));
    assert.ok(service.includes("async function waitForUrl("));
    const waitStart = service.indexOf("async function wait(");
    const waitForUrlStart = service.indexOf("async function waitForUrl(");
    const waitBody = service.slice(waitStart, waitForUrlStart);
    const waitForUrlBody = service.slice(waitForUrlStart, service.indexOf("async function completeRewardActivityTab"));
    assert.match(waitBody, /listenForTabGone\(chrome\.tabs/);
    assert.match(waitForUrlBody, /listenForTabGone\(chrome\.tabs/);
  });

  it("uses two attempts and acknowledges stop before asynchronous cleanup", () => {
    assert.match(service, /const searchAttempts = 2;/);
    assert.match(service, /const emulationAttempts = 2;/);
    const stopCase = service.slice(
      service.indexOf("case ACTIONS.STOP"),
      service.indexOf("case ACTIONS.CLEAR_BROWSING_DATA"),
    );
    assert.ok(stopCase.indexOf("reply({") < stopCase.indexOf("handleUserStop()"));
  });

  it("limits manual starts by live counters and filters automatic offers", () => {
    assert.match(service, /refreshSearchCountersFromRewards\(\)/);
    assert.doesNotMatch(service, /force:\s*true/);
    assert.match(service, /classifyAutomaticTask\(offer\)\.safe/);
  });
});

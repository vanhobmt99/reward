/**
 * Evidence: the touched helper modules evaluate in Node without a chrome
 * global. Imports the real shipped files.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as searchPlan from "../js/search-plan.js";
import * as scheduleUtils from "../js/schedule-utils.js";
import * as dailyCounters from "../js/daily-counters.js";
import * as searchCredit from "../js/search-credit.js";
import * as searchResults from "../js/search-results.js";
import * as rewardsMetrics from "../js/rewards-metrics.js";
import * as activityMemory from "../js/activity-memory.js";
import * as activityPass from "../js/activity-pass-utils.js";
import * as utils from "../js/utils.js";
import * as tabErrors from "../js/tab-errors.js";
import * as configDefaults from "../js/config-defaults.js";

describe("helper modules load without chrome", () => {
  it("does not define a chrome global", () => {
    assert.equal(globalThis.chrome, undefined);
  });

  const required = {
    "search-plan.js": [
      searchPlan.hasSearchWork,
      searchPlan.normalizeSearchPlan,
      searchPlan.toSearchCount,
    ],
    "schedule-utils.js": [scheduleUtils.isScheduledModeActive],
    "daily-counters.js": [dailyCounters.limitPlanForCompletedCounters],
    "search-credit.js": [
      searchCredit.createSearchCreditGoal,
      searchCredit.shouldContinueSearch,
      searchCredit.assessSearchCheckpoint,
    ],
    "search-results.js": [searchResults.isCompleteSearchCount],
    "rewards-metrics.js": [
      rewardsMetrics.buildRewardsSnapshot,
      rewardsMetrics.getScoreDelta,
      rewardsMetrics.pickActiveCounter,
      rewardsMetrics.getRewardsSearchCounterDone,
      rewardsMetrics.isRewardsSearchCounterComplete,
    ],
    "activity-memory.js": [
      activityMemory.getBlockedActivityKeys,
      activityMemory.confirmActivityKeys,
      activityMemory.migrateActivityMemory,
    ],
    "activity-pass-utils.js": [activityPass.shouldStopClaimPass],
    "utils.js": [
      utils.getRewardsSearchCounterDone,
      utils.isRewardsSearchCounterComplete,
      utils.isDailySearchCounterDone,
    ],
    "tab-errors.js": [tabErrors.isTabGoneError, tabErrors.listenForTabGone],
    "config-defaults.js": [configDefaults.createDefaultConfig],
  };

  for (const [name, fns] of Object.entries(required)) {
    it(`evaluates ${name} and exports callable helpers`, () => {
      for (const fn of fns) {
        assert.equal(typeof fn, "function");
      }
    });
  }
});

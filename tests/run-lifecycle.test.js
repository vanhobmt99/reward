import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyAutomaticTask } from "../js/activity-policy.js";
import {
  createRunCheckpoint,
  getCheckpointRemainingPlan,
  validateRunCheckpoint,
  RUN_CHECKPOINT_TTL_MS,
} from "../js/run-checkpoint.js";
import {
  ACTIVITY_DEADLINE_MS,
  createRunDeadlines,
  getSearchDeadlineMs,
  SEARCH_DEADLINE_MAX_MS,
  startActivityDeadline,
} from "../js/run-deadline.js";
import {
  appendRunReport,
  createRunResult,
  RUN_OUTCOMES,
  summarizeRunResults,
} from "../js/run-results.js";
import {
  createPopupRunViewModel,
  formatDuration,
} from "../js/popup-view-model.js";
import { createDefaultConfig } from "../js/config-defaults.js";
import { applyConfigDefaults } from "../js/utils.js";
import {
  createDashboardActivityScript,
  createEarnActivityScript,
} from "../js/injected-scripts.js";

describe("bounded run lifecycle", () => {
  it("caps the dynamic search deadline and bounds activities by the session", () => {
    assert.equal(getSearchDeadlineMs(0), 3 * 60 * 1000);
    assert.equal(getSearchDeadlineMs(999), SEARCH_DEADLINE_MAX_MS);
    const runtime = createRunDeadlines({
      searchCount: 3,
      includeActivities: true,
      startedAt: 1_000,
    });
    assert.equal(runtime.searchDeadlineAt, 1_000 + 4 * 60 * 1000);
    assert.equal(
      startActivityDeadline(runtime, runtime.deadlineAt - 5_000),
      runtime.deadlineAt,
    );
    assert.ok(ACTIVITY_DEADLINE_MS > 0);
  });

  it("resumes only a fresh checkpoint and only its remaining work", () => {
    const now = 50_000;
    const checkpoint = createRunCheckpoint({
      sessionId: "search-1",
      requested: { desk: 3, mob: 2 },
      progress: { desk: { finished: true, attempted: 2 }, mob: { attempted: 1 } },
      accountKey: "hash-a",
      deadlines: { startedAt: now - 5_000, deadlineAt: now + 60_000 },
      updatedAt: now - 1_000,
    });
    assert.equal(validateRunCheckpoint(checkpoint, { now, accountKey: "hash-a" }).valid, true);
    assert.deepEqual(getCheckpointRemainingPlan(checkpoint), {
      desk: 0,
      mob: 1,
    });
    assert.equal(
      validateRunCheckpoint(checkpoint, {
        now: checkpoint.updatedAt + RUN_CHECKPOINT_TTL_MS + 1,
      }).reason,
      "expired",
    );
  });

  it("keeps at most seven privacy-safe run reports", () => {
    const result = createRunResult({ outcome: RUN_OUTCOMES.COMPLETED });
    const history = Array.from({ length: 10 }, (_, id) => ({ id }));
    const reports = appendRunReport(history, { result }, 7);
    assert.equal(reports.length, 7);
    assert.deepEqual(summarizeRunResults([result]), {
      completed: 1,
      uncertain: 0,
      failed: 0,
      skipped: 0,
    });
    assert.equal(JSON.stringify(reports).includes("query"), false);
  });

  it("migrates runtime schema and removes unknown report payload fields", () => {
    const config = createDefaultConfig();
    applyConfigDefaults(config, {
      runtime: { schemaVersion: 1 },
      runReports: [
        {
          done: 1,
          total: 1,
          query: "private query",
          account: "private account",
          result: { outcome: "completed" },
        },
      ],
    });
    assert.equal(config.runtime.schemaVersion, 2);
    assert.equal(config.runReports.length, 1);
    assert.equal("query" in config.runReports[0], false);
    assert.equal("account" in config.runReports[0], false);
  });
});

describe("automatic activity policy", () => {
  it("accepts simple visits and clear polls", () => {
    assert.equal(classifyAutomaticTask({ visitCompletes: true }).safe, true);
    assert.equal(classifyAutomaticTask({ title: "Daily poll +5" }).safe, true);
  });

  it("rejects quizzes, purchases, app installs, games, and unclear tasks", () => {
    for (const title of [
      "Take a quiz",
      "Buy a gift card",
      "Download the app",
      "Play a game",
      "Mystery bonus",
    ]) {
      assert.equal(classifyAutomaticTask({ title }).safe, false, title);
    }
  });

  it("generates DOM scans for the live section ids and disabled state", () => {
    const daily = createDashboardActivityScript([], 1, true);
    const earn = createEarnActivityScript([], 1, true);
    assert.match(daily, /#dailyset/);
    assert.match(earn, /#moreactivities/);
    assert.match(daily, /aria-disabled/);
    assert.match(earn, /unsupported automatic task/);
  });
});

describe("popup run status", () => {
  it("shows progress, deadline, retries, and the last report", () => {
    const now = 120_000;
    const view = createPopupRunViewModel(
      {
        runtime: {
          running: 1,
          currentPhase: "search",
          startedAt: 60_000,
          searchDeadlineAt: 180_000,
          deadlineAt: 200_000,
          total: 5,
          done: 2,
          failed: 1,
          retry: 1,
        },
        runReports: [],
      },
      now,
    );
    assert.equal(view.detail, "3/5 bước · 1 lỗi");
    assert.match(view.meta, /Đã chạy 1 phút/);
    assert.match(view.meta, /thử lại 1\/2/);
    assert.equal(formatDuration(65_000), "1 phút 5 giây");
  });
});

export const RUN_OUTCOMES = Object.freeze({
  COMPLETED: "completed",
  UNCERTAIN: "uncertain",
  FAILED: "failed",
  SKIPPED: "skipped",
});

export function createRunResult({
  outcome,
  item = "run",
  reason = null,
  at = Date.now(),
} = {}) {
  const normalizedOutcome = Object.values(RUN_OUTCOMES).includes(outcome)
    ? outcome
    : RUN_OUTCOMES.UNCERTAIN;
  return {
    outcome: normalizedOutcome,
    item: String(item || "run"),
    reason: reason ? String(reason) : null,
    at,
  };
}

export function summarizeRunResults(results = []) {
  const summary = {
    completed: 0,
    uncertain: 0,
    failed: 0,
    skipped: 0,
  };
  for (const result of results) {
    const key = result?.outcome;
    if (Object.hasOwn(summary, key)) summary[key]++;
  }
  return summary;
}

export function appendRunReport(history, report, limit = 7) {
  const safeHistory = Array.isArray(history) ? history : [];
  return [report, ...safeHistory].slice(0, Math.max(1, Number(limit) || 7));
}

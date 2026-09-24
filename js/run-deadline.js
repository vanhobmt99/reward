export const SEARCH_DEADLINE_BASE_MS = 3 * 60 * 1000;
export const SEARCH_DEADLINE_PER_ITEM_MS = 20 * 1000;
export const SEARCH_DEADLINE_MAX_MS = 25 * 60 * 1000;
export const ACTIVITY_DEADLINE_MS = 12 * 60 * 1000;
export const SESSION_DEADLINE_MAX_MS = 35 * 60 * 1000;

export function getSearchDeadlineMs(searchCount) {
  const count = Math.max(0, Number(searchCount) || 0);
  return Math.min(
    SEARCH_DEADLINE_MAX_MS,
    SEARCH_DEADLINE_BASE_MS + count * SEARCH_DEADLINE_PER_ITEM_MS,
  );
}

export function createRunDeadlines({
  searchCount = 0,
  includeActivities = false,
  startedAt = Date.now(),
} = {}) {
  const searchMs = getSearchDeadlineMs(searchCount);
  const sessionMs = Math.min(
    SESSION_DEADLINE_MAX_MS,
    searchMs + (includeActivities ? ACTIVITY_DEADLINE_MS : 0),
  );

  return {
    startedAt,
    searchDeadlineAt: startedAt + searchMs,
    activityDeadlineAt: null,
    deadlineAt: startedAt + sessionMs,
  };
}

export function startActivityDeadline(runtime, now = Date.now()) {
  if (!runtime) return null;
  const sessionDeadline = Number(runtime.deadlineAt) || now + ACTIVITY_DEADLINE_MS;
  runtime.activityDeadlineAt = Math.min(
    sessionDeadline,
    Number(runtime.activityDeadlineAt) || Infinity,
    now + ACTIVITY_DEADLINE_MS,
  );
  return runtime.activityDeadlineAt;
}

export function getActiveDeadline(runtime) {
  if (!runtime) return null;
  const phase = String(runtime.currentPhase || "");
  if (phase === "activities" && Number(runtime.activityDeadlineAt)) {
    return Number(runtime.activityDeadlineAt);
  }
  if (
    phase.includes("search") ||
    phase.startsWith("mobile") ||
    phase === "post_mobile"
  ) {
    return Math.min(
      Number(runtime.searchDeadlineAt) || Infinity,
      Number(runtime.deadlineAt) || Infinity,
    );
  }
  return Number(runtime.deadlineAt) || null;
}

export function isRunDeadlineExpired(runtime, now = Date.now()) {
  const deadline = getActiveDeadline(runtime);
  return Number.isFinite(deadline) && now >= deadline;
}

export function getRemainingDeadlineMs(runtime, now = Date.now()) {
  const deadline = getActiveDeadline(runtime);
  if (!Number.isFinite(deadline)) return null;
  return Math.max(0, deadline - now);
}

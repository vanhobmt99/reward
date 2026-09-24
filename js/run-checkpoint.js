export const RUN_CHECKPOINT_KEY = "runCheckpoint";
export const RUN_CHECKPOINT_TTL_MS = 2 * 60 * 1000;

const count = (value) => Math.max(0, Math.floor(Number(value) || 0));
export function createRunCheckpoint({ sessionId, mode, phase, requested,
  progress = {}, accountKey = null, deadlines = {}, updatedAt = Date.now(),
  status = "active",
} = {}) {
  return {
    version: 2, sessionId: String(sessionId || ""), mode, phase, status,
    requested: { desk: count(requested?.desk), mob: count(requested?.mob) },
    progress: Object.fromEntries(["desk", "mob"].map((key) => [key, {
      attempted: count(progress[key]?.attempted), finished: progress[key]?.finished === true,
    }])),
    accountKey,
    startedAt: deadlines.startedAt, deadlineAt: deadlines.deadlineAt,
    searchDeadlineAt: deadlines.searchDeadlineAt,
    activityDeadlineAt: deadlines.activityDeadlineAt,
    updatedAt,
  };
}

export function validateRunCheckpoint(checkpoint, { now = Date.now(), accountKey,
  verifyAccount = true,
} = {}) {
  if (!checkpoint || checkpoint.version !== 2 || !checkpoint.sessionId || checkpoint.status !== "active") {
    return { valid: false, reason: "invalid" };
  }
  const ageMs = now - Number(checkpoint.updatedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > RUN_CHECKPOINT_TTL_MS) {
    return { valid: false, reason: "expired" };
  }
  if (!Number.isFinite(checkpoint.startedAt) || !Number.isFinite(checkpoint.deadlineAt) ||
      checkpoint.startedAt > now || checkpoint.deadlineAt <= now) {
    return { valid: false, reason: "deadline_exceeded" };
  }
  if (verifyAccount && (!accountKey || !checkpoint.accountKey || accountKey !== checkpoint.accountKey)) {
    return { valid: false, reason: "account_mismatch" };
  }
  return { valid: true, reason: null, ageMs };
}

export function getCheckpointRemainingPlan(checkpoint) {
  return Object.fromEntries(["desk", "mob"].map((key) => [key,
    checkpoint?.progress?.[key]?.finished ? 0 : Math.max(0,
      count(checkpoint?.requested?.[key]) - count(checkpoint?.progress?.[key]?.attempted)),
  ]));
}

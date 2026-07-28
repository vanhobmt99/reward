export const SCHEDULE_ALARM_MODES = {
  m3: { min: 300, range: 150 },
  m4: { min: 900, range: 150 },
};

export function getScheduleAlarmDelayMs(mode) {
  const spec = SCHEDULE_ALARM_MODES[mode];
  if (!spec) return null;
  return (Math.floor(Math.random() * spec.range) + spec.min) * 1000;
}

export function isScheduledModeActive(schedule) {
  // Without a schedule there is nothing to run: the `Number(undefined) !== 0`
  // (NaN) checks below would otherwise report active for a missing schedule.
  if (!schedule) return false;
  // m5 ("daily at a fixed time") is deliberately NOT "active" here: this
  // predicate gates the run-immediately paths (startup, counter-refresh
  // alarms) and the post-run re-arm. m5 runs ONLY off its own periodic
  // "schedule_daily" alarm — no catch-up runs.
  return (
    !["m1", "m2", "m5"].includes(schedule.mode) &&
    (Number(schedule.desk) !== 0 || Number(schedule.mob) !== 0)
  );
}

// Default wall-clock time for the m5 daily mode ("HH:MM", 24h).
export const DEFAULT_DAILY_TIME = "08:00";

/**
 * Parse an "HH:MM" string into {hours, minutes}, or null when malformed.
 * Exported for tests; service/popup use getDailyAlarmWhen/normalizeDailyTime.
 */
export function parseDailyTime(time) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(time || "").trim());
  if (!match) return null;
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

/**
 * Return a canonical zero-padded "HH:MM" string, falling back to
 * DEFAULT_DAILY_TIME. Re-serialized from the parsed parts so values like
 * "8:05" (valid for the alarm math but rejected by <input type=time>) always
 * round-trip into the popup's picker.
 */
export function normalizeDailyTime(time) {
  const parsed = parseDailyTime(time);
  if (!parsed) return DEFAULT_DAILY_TIME;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(parsed.hours)}:${pad(parsed.minutes)}`;
}

/**
 * Epoch ms of the NEXT occurrence of `time` ("HH:MM"): today if still ahead,
 * otherwise tomorrow. `now` is injectable for tests.
 */
export function getDailyAlarmWhen(time, now = Date.now()) {
  const parsed = parseDailyTime(time) || parseDailyTime(DEFAULT_DAILY_TIME);
  const next = new Date(now);
  next.setHours(parsed.hours, parsed.minutes, 0, 0);
  if (next.getTime() <= now) next.setDate(next.getDate() + 1);
  return next.getTime();
}

export async function armScheduleAlarmForMode(
  mode,
  createAlarm = (name, opts) => chrome.alarms.create(name, opts),
) {
  const delayMs = getScheduleAlarmDelayMs(mode);
  if (!delayMs) return false;
  await createAlarm("schedule", { when: Date.now() + delayMs });
  // Return the actual armed delay so callers can log the real value instead
  // of drawing a fresh (different) random number.
  return delayMs;
}

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(
  path.join(__dirname, "../js/schedule-utils.js"),
  "utf8",
);
const modifiedSource = `${source.replace(/export /g, "")}
module.exports = {
  SCHEDULE_ALARM_MODES,
  getScheduleAlarmDelayMs,
  isScheduledModeActive,
  armScheduleAlarmForMode,
  DEFAULT_DAILY_TIME,
  parseDailyTime,
  normalizeDailyTime,
  getDailyAlarmWhen,
};
`;

const sandbox = {
  module: { exports: {} },
  chrome: { alarms: { create: jest.fn() } },
};
vm.createContext(sandbox);
vm.runInContext(modifiedSource, sandbox);

const {
  getScheduleAlarmDelayMs,
  isScheduledModeActive,
  SCHEDULE_ALARM_MODES,
  DEFAULT_DAILY_TIME,
  parseDailyTime,
  normalizeDailyTime,
  getDailyAlarmWhen,
} = sandbox.module.exports;

describe("schedule-utils", () => {
  test("exposes m3 and m4 alarm modes", () => {
    expect(SCHEDULE_ALARM_MODES.m3).toEqual({ min: 300, range: 150 });
    expect(SCHEDULE_ALARM_MODES.m4).toEqual({ min: 900, range: 150 });
  });

  test("getScheduleAlarmDelayMs returns null for unsupported modes", () => {
    expect(getScheduleAlarmDelayMs("m1")).toBeNull();
  });

  test("getScheduleAlarmDelayMs stays within configured bounds", () => {
    const delayMs = getScheduleAlarmDelayMs("m3");
    expect(delayMs).toBeGreaterThanOrEqual(300000);
    expect(delayMs).toBeLessThanOrEqual(450000);
  });

  test("isScheduledModeActive ignores m1/m2 and zero plans", () => {
    expect(isScheduledModeActive({ mode: "m1", desk: 10, mob: 5 })).toBe(false);
    expect(isScheduledModeActive({ mode: "m3", desk: 0, mob: 0 })).toBe(false);
    expect(isScheduledModeActive({ mode: "m4", desk: 5, mob: 3 })).toBe(true);
  });

  test("m5 (daily at fixed time) is not an 'active' periodic mode", () => {
    // m5 must not trigger the run-immediately paths (startup/counter alarms)
    // nor the post-run re-arm — it runs only off its own periodic alarm.
    expect(isScheduledModeActive({ mode: "m5", desk: 10, mob: 5 })).toBe(false);
  });

  test("parseDailyTime accepts valid HH:MM and rejects garbage", () => {
    expect(parseDailyTime("08:00")).toEqual({ hours: 8, minutes: 0 });
    expect(parseDailyTime("23:59")).toEqual({ hours: 23, minutes: 59 });
    expect(parseDailyTime("8:05")).toEqual({ hours: 8, minutes: 5 });
    expect(parseDailyTime("24:00")).toBeNull();
    expect(parseDailyTime("12:60")).toBeNull();
    expect(parseDailyTime("noon")).toBeNull();
    expect(parseDailyTime("")).toBeNull();
    expect(parseDailyTime(null)).toBeNull();
  });

  test("normalizeDailyTime falls back to the default", () => {
    expect(normalizeDailyTime("09:30")).toBe("09:30");
    expect(normalizeDailyTime("bogus")).toBe(DEFAULT_DAILY_TIME);
    expect(normalizeDailyTime(undefined)).toBe(DEFAULT_DAILY_TIME);
  });

  test("normalizeDailyTime zero-pads to canonical HH:MM", () => {
    // <input type=time> rejects "8:05", so stored config must stay padded.
    expect(normalizeDailyTime("8:05")).toBe("08:05");
    expect(normalizeDailyTime(" 8:05 ")).toBe("08:05");
  });

  test("getDailyAlarmWhen picks today when the time is still ahead", () => {
    const now = new Date(2026, 6, 20, 6, 0, 0, 0).getTime(); // 06:00 local
    const when = getDailyAlarmWhen("08:00", now);
    const expected = new Date(2026, 6, 20, 8, 0, 0, 0).getTime();
    expect(when).toBe(expected);
  });

  test("getDailyAlarmWhen rolls to tomorrow when the time has passed", () => {
    const now = new Date(2026, 6, 20, 9, 0, 0, 0).getTime(); // 09:00 local
    const when = getDailyAlarmWhen("08:00", now);
    const expected = new Date(2026, 6, 21, 8, 0, 0, 0).getTime();
    expect(when).toBe(expected);
  });

  test("getDailyAlarmWhen at exactly the boundary rolls forward", () => {
    const now = new Date(2026, 6, 20, 8, 0, 0, 0).getTime();
    const when = getDailyAlarmWhen("08:00", now);
    const expected = new Date(2026, 6, 21, 8, 0, 0, 0).getTime();
    expect(when).toBe(expected);
  });

  test("getDailyAlarmWhen falls back to default time for invalid input", () => {
    const now = new Date(2026, 6, 20, 6, 0, 0, 0).getTime();
    const when = getDailyAlarmWhen("nonsense", now);
    const expected = new Date(2026, 6, 20, 8, 0, 0, 0).getTime(); // 08:00 default
    expect(when).toBe(expected);
  });
});

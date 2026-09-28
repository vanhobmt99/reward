const { loadEsmModule } = require("./esm-loader.js");

const { todayKey, areCountersFresh, limitPlanForCompletedCounters } =
  loadEsmModule("../js/daily-counters.js");

describe("todayKey", () => {
  test("formats a local date as YYYY-MM-DD with zero padding", () => {
    // Month is 0-indexed in Date: 2 => March.
    expect(todayKey(new Date(2026, 2, 5))).toBe("2026-03-05");
  });

  test("pads single-digit month and day", () => {
    expect(todayKey(new Date(2026, 0, 1))).toBe("2026-01-01");
  });

  test("handles end-of-year dates", () => {
    expect(todayKey(new Date(2025, 11, 31))).toBe("2025-12-31");
  });
});

describe("areCountersFresh", () => {
  test("true when stored date equals today's key", () => {
    expect(
      areCountersFresh({ searchCounterDate: "2026-07-10" }, "2026-07-10"),
    ).toBe(true);
  });

  test("false for a stale or missing date", () => {
    expect(
      areCountersFresh({ searchCounterDate: "2026-07-09" }, "2026-07-10"),
    ).toBe(false);
    expect(areCountersFresh({}, "2026-07-10")).toBe(false);
    expect(areCountersFresh(null, "2026-07-10")).toBe(false);
  });
});

describe("limitPlanForCompletedCounters", () => {
  test("zeroes desk when pc counter is done", () => {
    const plan = { desk: 30, mob: 20 };
    expect(limitPlanForCompletedCounters(plan, { pcDone: true })).toMatchObject(
      { desk: 0, mob: 20 },
    );
  });

  test("zeroes mob when mobile counter is done", () => {
    const plan = { desk: 30, mob: 20 };
    expect(
      limitPlanForCompletedCounters(plan, { mobileDone: true }),
    ).toMatchObject({ desk: 30, mob: 0 });
  });

  test("zeroes both when both done", () => {
    const out = limitPlanForCompletedCounters(
      { desk: 5, mob: 5 },
      { pcDone: true, mobileDone: true },
    );
    expect(out).toMatchObject({ desk: 0, mob: 0 });
  });

  test("does not mutate the input plan", () => {
    const plan = { desk: 30, mob: 20 };
    limitPlanForCompletedCounters(plan, { pcDone: true, mobileDone: true });
    expect(plan).toEqual({ desk: 30, mob: 20 });
  });

  test("leaves plan unchanged when nothing is done", () => {
    expect(
      limitPlanForCompletedCounters({ desk: 10, mob: 8 }, {}),
    ).toMatchObject({ desk: 10, mob: 8 });
  });
});

const { loadEsmModule } = require("./esm-loader.js");

const { formatActivityDiag, shouldStopClaimPass } = loadEsmModule(
  "../js/activity-pass-utils.js",
);

describe("formatActivityDiag", () => {
  test("matches the exact legacy DIAG line format", () => {
    const line = formatActivityDiag("Dashboard", 2, {
      clicked: [{ text: "+10 quiz" }],
      skipped: [
        { text: "done card", reason: "already done" },
        { text: "plain" },
      ],
      reason: "",
      pointDelta: 10,
      processedTabs: 1,
      confirmed: true,
    });
    expect(line).toBe(
      `[DIAG] Dashboard pass 2: clicked=["+10 quiz"] skipped=["done card <already done>","plain"] reason=- delta=10 processedTabs=1 confirmed=true`,
    );
  });

  test("uses the given label and dashes an empty reason", () => {
    const line = formatActivityDiag("Earn", 1, {
      clicked: [],
      skipped: [],
      reason: null,
      pointDelta: null,
      processedTabs: 0,
      confirmed: false,
    });
    expect(line).toBe(
      `[DIAG] Earn pass 1: clicked=[] skipped=[] reason=- delta=null processedTabs=0 confirmed=false`,
    );
  });

  test("tolerates missing clicked/skipped arrays", () => {
    expect(() => formatActivityDiag("Earn", 3, {})).not.toThrow();
  });
});

describe("shouldStopClaimPass", () => {
  test("stops immediately after points are confirmed", () => {
    expect(
      shouldStopClaimPass({
        clicked: true,
        count: 6,
        pointDelta: 6,
        retry: false,
      }),
    ).toBe(true);
  });

  test("continues from the opened card to its confirm control", () => {
    expect(
      shouldStopClaimPass({
        clicked: true,
        count: 6,
        pointDelta: 0,
        retry: false,
      }),
    ).toBe(false);
  });

  test("honours retries before treating a missing control as terminal", () => {
    expect(
      shouldStopClaimPass({
        clicked: false,
        count: null,
        pointDelta: null,
        retry: true,
      }),
    ).toBe(false);
    expect(
      shouldStopClaimPass({
        clicked: false,
        count: 0,
        pointDelta: null,
        retry: false,
      }),
    ).toBe(true);
  });
});

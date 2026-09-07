const { loadEsmModule } = require("./esm-loader");
const { runDailySet } = loadEsmModule("../js/daily-set-runner.js");

function deps(status = "pending") {
  return {
    inspect: jest.fn().mockResolvedValue({ status }),
    scan: jest.fn().mockResolvedValue({ clicked: 0, processed: 0 }),
    recover: jest.fn(),
    active: () => true,
    onPass: jest.fn(),
  };
}

test("three empty scans trigger recovery, not success", async () => {
  const d = deps();
  d.recover.mockImplementation(() =>
    d.inspect.mockResolvedValue({ status: "complete" }),
  );
  expect((await runDailySet(d)).complete).toBe(true);
  expect(d.scan).toHaveBeenCalledTimes(3);
  expect(d.recover).toHaveBeenCalledTimes(1);
});

test.each(["loading", "unknown", "pending"])(
  "persistent %s remains unsuccessful after bounded recovery",
  async (status) => {
    const d = deps(status);
    expect((await runDailySet(d)).complete).toBe(false);
    expect(d.recover).toHaveBeenCalledTimes(2);
    expect(d.scan).toHaveBeenCalledTimes(status === "pending" ? 9 : 0);
  },
);

test("clicks and points alone never certify completion", async () => {
  const d = deps();
  d.scan.mockResolvedValue({ clicked: 1, processed: 1, pointDelta: 10 });
  expect((await runDailySet({ ...d, maxPasses: 4 })).complete).toBe(false);
});

test("stop during inspection prevents further clicks and reloads", async () => {
  const d = deps();
  let active = true;
  d.active = () => active;
  d.inspect.mockImplementation(async () => {
    active = false;
    return { status: "pending" };
  });
  expect((await runDailySet(d)).reason).toBe("stopped");
  expect(d.scan).not.toHaveBeenCalled();
  expect(d.recover).not.toHaveBeenCalled();
});

test("a completed set is accepted without another click", async () => {
  const d = deps("complete");
  expect((await runDailySet(d)).complete).toBe(true);
  expect(d.scan).not.toHaveBeenCalled();
});

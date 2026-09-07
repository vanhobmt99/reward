const { loadEsmModule } = require("./esm-loader");
const { checkActivityAccess, classifyActivityAccessError } = loadEsmModule(
  "../js/activity-access.js",
);

test("Edge Rewards access denial stops after one attempt", async () => {
  const tryAttach = jest
    .fn()
    .mockResolvedValue({
      ok: false,
      error: new Error("The extensions gallery cannot be scripted."),
    });
  const pause = jest.fn();
  const result = await checkActivityAccess({
    tryAttach,
    pause,
    active: () => true,
    userAgent: "Edg/152.0.0.0",
  });
  expect(result).toMatchObject({
    ok: false,
    issue: { code: "browser_access_blocked", retryable: false },
  });
  expect(result.issue.message).toContain("Edge");
  expect(tryAttach).toHaveBeenCalledTimes(1);
  expect(pause).not.toHaveBeenCalled();
});

test("a transient connection error gets one retry and can recover", async () => {
  const tryAttach = jest
    .fn()
    .mockResolvedValueOnce({ ok: false, error: "Operation timed out" })
    .mockResolvedValueOnce({ ok: true });
  const pause = jest.fn();
  expect(
    await checkActivityAccess({ tryAttach, pause, active: () => true }),
  ).toEqual({ ok: true });
  expect(tryAttach).toHaveBeenCalledTimes(2);
  expect(pause).toHaveBeenCalledTimes(1);
});

test("does not confuse another debugger with a site restriction", () => {
  expect(
    classifyActivityAccessError("Another debugger is already attached").code,
  ).toBe("activity_connection_failed");
});

test("stop during retry wait prevents another attach", async () => {
  let active = true;
  const tryAttach = jest
    .fn()
    .mockResolvedValue({ ok: false, error: "Disconnected" });
  const result = await checkActivityAccess({
    tryAttach,
    active: () => active,
    pause: async () => {
      active = false;
    },
  });
  expect(result).toEqual({ ok: false, stopped: true });
  expect(tryAttach).toHaveBeenCalledTimes(1);
});

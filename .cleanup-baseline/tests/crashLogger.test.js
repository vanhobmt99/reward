const { loadEsmModule } = require("./esm-loader");

function loadLogger() {
  const stored = {};
  const chrome = {
    runtime: {},
    storage: {
      local: {
        get: (key, callback) => callback({ [key]: stored[key] }),
        set: (values, callback) => {
          Object.assign(stored, values);
          callback();
        },
      },
    },
  };
  return {
    stored,
    logger: loadEsmModule("../js/crash-logger.js", {
      chrome,
      console: { error: jest.fn() },
      self: { addEventListener: jest.fn() },
      Date,
      JSON,
      Promise,
    }),
  };
}

test("handled activity restrictions are diagnostic events, not crashes", async () => {
  const { stored, logger } = loadLogger();
  await logger.recordEvent(
    "activity-access",
    "The extensions gallery cannot be scripted.",
    { code: "browser_access_blocked" },
  );
  expect(stored._crashLog).toEqual([
    expect.objectContaining({
      level: "event",
      context: "activity-access",
      message: "The extensions gallery cannot be scripted.",
    }),
  ]);
});

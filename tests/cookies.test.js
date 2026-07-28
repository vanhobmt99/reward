const { loadEsmModule } = require("./esm-loader.js");

const { createCookieHelpers } = loadEsmModule("../js/cookies.js");

describe("cookie recovery details", () => {
  test("marks a backup incomplete when either cleared domain cannot be read", async () => {
    const cookies = {
      getAll: jest.fn(async ({ domain }) => {
        if (domain === "rewards.bing.com") throw new Error("API unavailable");
        return [
          {
            name: "MUID",
            value: "x",
            domain: ".bing.com",
            path: "/",
            secure: true,
          },
        ];
      }),
    };
    const { backupAuthCookiesDetailed } = createCookieHelpers({ cookies });

    const result = await backupAuthCookiesDetailed();

    expect(result.cookies).toHaveLength(1);
    expect(result.complete).toBe(false);
    expect(result.failedDomains).toEqual(["rewards.bing.com"]);
  });

  test("reports partial restore so the pending snapshot can be retained", async () => {
    const cookies = {
      get: jest.fn(async () => null),
      set: jest
        .fn()
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error("temporary failure")),
    };
    const { restoreAuthCookiesDetailed } = createCookieHelpers({ cookies });
    const snapshot = [
      {
        name: "A",
        value: "1",
        domain: ".bing.com",
        path: "/",
        secure: true,
      },
      {
        name: "B",
        value: "2",
        domain: ".bing.com",
        path: "/",
        secure: true,
      },
    ];

    const result = await restoreAuthCookiesDetailed(snapshot);

    expect(result).toMatchObject({ restored: 1, failed: 1, complete: false });
  });
});

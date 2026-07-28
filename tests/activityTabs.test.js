const { loadEsmModule } = require("./esm-loader.js");

const { isRewardActivityUrl, isActivityOpenedTab } = loadEsmModule(
  "../js/activity-tabs.js",
  { URL },
);

describe("activity tab ownership", () => {
  test("matches only real Microsoft/Bing hostnames", () => {
    expect(isRewardActivityUrl("https://rewards.bing.com/dashboard")).toBe(
      true,
    );
    expect(isRewardActivityUrl("https://login.live.com/oauth")).toBe(true);
    expect(
      isRewardActivityUrl("https://example.com/?next=rewards.bing.com"),
    ).toBe(false);
    expect(isRewardActivityUrl("chrome://extensions")).toBe(false);
  });

  test("accepts a new reward tab opened by the automation tab", () => {
    const existing = new Set([1, 2]);
    expect(
      isActivityOpenedTab(
        {
          id: 3,
          openerTabId: 10,
          url: "https://rewards.bing.com/activity",
        },
        10,
        existing,
      ),
    ).toBe(true);
  });

  test("rejects a Microsoft tab opened independently by the user", () => {
    expect(
      isActivityOpenedTab(
        { id: 3, url: "https://outlook.com/mail" },
        10,
        new Set(),
      ),
    ).toBe(false);
  });

  test("allows a temporary about:blank only with the correct opener", () => {
    expect(
      isActivityOpenedTab(
        { id: 3, openerTabId: 10, pendingUrl: "about:blank" },
        10,
        new Set(),
      ),
    ).toBe(true);
    expect(
      isActivityOpenedTab(
        { id: 4, openerTabId: 99, pendingUrl: "about:blank" },
        10,
        new Set(),
      ),
    ).toBe(false);
  });
});

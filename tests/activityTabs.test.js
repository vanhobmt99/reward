const { loadEsmModule } = require("./esm-loader.js");

const { isRewardActivityUrl, isActivityOpenedTab, tabsToClose } = loadEsmModule(
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

  test("does not close the main tab or a tab that already existed", () => {
    const existing = new Set([1, 3]);
    expect(
      isActivityOpenedTab(
        { id: 3, url: "https://outlook.com/mail" },
        10,
        existing,
      ),
    ).toBe(false);
    expect(
      isActivityOpenedTab(
        { id: 10, url: "https://rewards.bing.com/dashboard" },
        10,
        existing,
      ),
    ).toBe(false);
  });

  test("closes a new tab with no opener, about:blank, or a non-reward host", () => {
    const existing = new Set([1, 10]);
    expect(
      isActivityOpenedTab(
        { id: 4, url: "https://www.bing.com/search?q=quiz" },
        10,
        existing,
      ),
    ).toBe(true);
    expect(
      isActivityOpenedTab({ id: 5, pendingUrl: "about:blank" }, 10, existing),
    ).toBe(true);
    expect(
      isActivityOpenedTab(
        { id: 6, url: "https://example.com/offer" },
        10,
        existing,
      ),
    ).toBe(true);
    expect(
      isActivityOpenedTab(
        { id: 7, openerTabId: 99, pendingUrl: "about:blank" },
        10,
        existing,
      ),
    ).toBe(true);
  });

  test("a later query still closes tabs missing from the original snapshot", () => {
    const snapshot = new Set([1, 10]);
    const first = [
      { id: 1, url: "https://rewards.bing.com/dashboard" },
      { id: 10, url: "https://rewards.bing.com/dashboard" },
      { id: 4, pendingUrl: "about:blank" },
    ];
    const later = first.concat([{ id: 8, url: "https://news.example/story" }]);
    expect(tabsToClose(first, 10, snapshot).map((tab) => tab.id)).toEqual([4]);
    expect(tabsToClose(later, 10, snapshot).map((tab) => tab.id)).toEqual([
      4, 8,
    ]);
  });
});

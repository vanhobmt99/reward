const { loadEsmModule } = require("./esm-loader.js");

const { isConfirmedBingSearchUrl, isCompleteSearchCount } = loadEsmModule(
  "../js/search-results.js",
  { URL },
);

describe("Bing search result confirmation", () => {
  test("accepts a Bing results URL with the expected query", () => {
    expect(
      isConfirmedBingSearchUrl(
        "https://www.bing.com/search?q=hello+world&form=QBLH",
        "Hello world",
      ),
    ).toBe(true);
  });

  test.each([
    "https://login.live.com/login.srf",
    "https://www.bing.com/ck/a?u=challenge",
    "https://www.bing.com/search?form=QBLH",
    "https://example.com/search?q=hello+world",
  ])("rejects redirects and non-result URLs: %s", (url) => {
    expect(isConfirmedBingSearchUrl(url, "hello world")).toBe(false);
  });

  test("rejects a result for a different query", () => {
    expect(
      isConfirmedBingSearchUrl(
        "https://www.bing.com/search?q=different",
        "expected",
      ),
    ).toBe(false);
  });

  test("requires every requested search to be confirmed", () => {
    expect(isCompleteSearchCount(30, 30)).toBe(true);
    expect(isCompleteSearchCount(1, 30)).toBe(false);
    expect(isCompleteSearchCount(0, 0)).toBe(false);
  });
});

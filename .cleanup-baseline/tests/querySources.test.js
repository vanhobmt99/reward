const { loadEsmModule } = require("./esm-loader.js");

const {
  buildSuggestUrl,
  parseSuggestResponse,
  normalizeSuggestions,
  buildQueryBurst,
  fetchSuggestions,
  buildGoogleTrendsUrl,
  buildWikipediaTopUrl,
  parseGoogleTrendsRss,
  normalizeTopicList,
  fetchGoogleTrends,
  fetchWikipediaTrending,
  fetchDynamicTopics,
  createDynamicTopicCache,
  readFreshDynamicTopicCache,
  BING_SUGGEST_ENDPOINT,
  MAX_SUGGESTION_LENGTH,
  // The vm sandbox has only ECMAScript intrinsics, so the web/Node globals the
  // module relies on have to be handed in explicitly.
} = loadEsmModule("../js/query-sources.js", {
  URL,
  AbortController,
  setTimeout,
  clearTimeout,
});

function seqRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

// Minimal Response stand-in; the module only touches .ok and .json().
function jsonResponse(payload, ok = true) {
  return { ok, json: async () => payload };
}

function textResponse(payload, ok = true) {
  return { ok, text: async () => payload };
}

describe("buildSuggestUrl", () => {
  test("targets the Bing OpenSearch endpoint with the query", () => {
    const url = new URL(buildSuggestUrl("iphone 17"));
    expect(`${url.origin}${url.pathname}`).toBe(BING_SUGGEST_ENDPOINT);
    expect(url.searchParams.get("query")).toBe("iphone 17");
  });

  test("omits mkt unless a market is supplied", () => {
    expect(new URL(buildSuggestUrl("x")).searchParams.has("mkt")).toBe(false);
    expect(
      new URL(buildSuggestUrl("x", { market: "en-GB" })).searchParams.get(
        "mkt",
      ),
    ).toBe("en-GB");
  });

  test("escapes characters that would otherwise break the query string", () => {
    const url = new URL(buildSuggestUrl("c++ & rust?"));
    expect(url.searchParams.get("query")).toBe("c++ & rust?");
  });
});

describe("parseSuggestResponse", () => {
  test("reads the OpenSearch array form", () => {
    expect(
      parseSuggestResponse(["iphone", ["iphone 17", "iphone 17 review"]]),
    ).toEqual(["iphone 17", "iphone 17 review"]);
  });

  test("collapses internal whitespace and trims", () => {
    expect(parseSuggestResponse(["a", ["  best   laptop  "]])).toEqual([
      "best laptop",
    ]);
  });

  test("drops non-string and empty entries", () => {
    expect(
      parseSuggestResponse(["a", ["ok", 42, null, "", "   ", { x: 1 }]]),
    ).toEqual(["ok"]);
  });

  test("returns [] for every malformed shape", () => {
    expect(parseSuggestResponse(null)).toEqual([]);
    expect(parseSuggestResponse(undefined)).toEqual([]);
    expect(parseSuggestResponse("not json")).toEqual([]);
    expect(parseSuggestResponse([])).toEqual([]);
    expect(parseSuggestResponse(["only the seed"])).toEqual([]);
    expect(parseSuggestResponse(["seed", "not an array"])).toEqual([]);
    expect(parseSuggestResponse({ error: "quota" })).toEqual([]);
  });
});

describe("normalizeSuggestions", () => {
  test("removes the seed itself, case-insensitively", () => {
    expect(
      normalizeSuggestions("IPhone 17", ["iphone 17", "iphone 17 case"]),
    ).toEqual(["iphone 17 case"]);
  });

  test("removes duplicates among the suggestions", () => {
    expect(normalizeSuggestions("a", ["b", "B", " b ", "c"])).toEqual([
      "b",
      "c",
    ]);
  });

  test("drops suggestions longer than the cap", () => {
    const long = "x".repeat(MAX_SUGGESTION_LENGTH + 1);
    expect(normalizeSuggestions("a", [long, "short"])).toEqual(["short"]);
  });

  test("tolerates a nullish list", () => {
    expect(normalizeSuggestions("a", null)).toEqual([]);
    expect(normalizeSuggestions("a", undefined)).toEqual([]);
  });
});

describe("buildQueryBurst", () => {
  test("puts the seed first and keeps Bing's ordering", () => {
    const burst = buildQueryBurst(
      "iphone 17",
      ["iphone 17 review", "iphone 17 vs 16", "iphone 17 price"],
      { rng: seqRng([0.99]), minSize: 4, maxSize: 4 },
    );
    expect(burst).toEqual([
      "iphone 17",
      "iphone 17 review",
      "iphone 17 vs 16",
      "iphone 17 price",
    ]);
  });

  test("never exceeds the rolled burst size", () => {
    const many = Array.from({ length: 20 }, (_, i) => `suggestion ${i}`);
    for (let seed = 0; seed < 50; seed++) {
      let n = seed + 1;
      const rng = () => {
        n = (n * 1103515245 + 12345) % 2147483648;
        return n / 2147483648;
      };
      const burst = buildQueryBurst("seed", many, {
        rng,
        minSize: 3,
        maxSize: 6,
      });
      expect(burst.length).toBeGreaterThanOrEqual(1);
      expect(burst.length).toBeLessThanOrEqual(6);
    }
  });

  test("falls back to the seed alone when there are no suggestions", () => {
    expect(buildQueryBurst("solo query", [], { rng: seqRng([0.5]) })).toEqual([
      "solo query",
    ]);
    expect(buildQueryBurst("solo query", null, { rng: seqRng([0.5]) })).toEqual(
      ["solo query"],
    );
  });

  test("returns nothing when the seed is empty", () => {
    expect(buildQueryBurst("", ["a"], { rng: seqRng([0.5]) })).toEqual([]);
    expect(buildQueryBurst("   ", ["a"], { rng: seqRng([0.5]) })).toEqual([]);
    expect(buildQueryBurst(null, ["a"], { rng: seqRng([0.5]) })).toEqual([]);
  });

  test("drops refinements already searched earlier in the run", () => {
    const burst = buildQueryBurst(
      "iphone 17",
      ["iphone 17 review", "iphone 17 vs 16", "iphone 17 price"],
      {
        rng: seqRng([0.99]),
        minSize: 4,
        maxSize: 4,
        exclude: new Set(["iphone 17 vs 16"]),
      },
    );
    expect(burst).toEqual(["iphone 17", "iphone 17 review", "iphone 17 price"]);
  });

  test("matches the exclude set case-insensitively", () => {
    const burst = buildQueryBurst("Laptop", ["Laptop Deals"], {
      rng: seqRng([0.99]),
      minSize: 3,
      maxSize: 3,
      exclude: new Set(["laptop deals"]),
    });
    expect(burst).toEqual(["Laptop"]);
  });

  test("drops a repeated seed but keeps its unused refinements", () => {
    const burst = buildQueryBurst(
      "laptop",
      ["laptop deals", "laptop docking"],
      {
        rng: seqRng([0.99]),
        minSize: 3,
        maxSize: 3,
        exclude: new Set(["laptop"]),
      },
    );
    expect(burst).toEqual(["laptop deals", "laptop docking"]);
  });

  test("returns nothing when the whole topic run was already searched", () => {
    const burst = buildQueryBurst("laptop", ["laptop deals"], {
      rng: seqRng([0.99]),
      minSize: 3,
      maxSize: 3,
      exclude: new Set(["laptop", "laptop deals"]),
    });
    expect(burst).toEqual([]);
  });

  test("without an exclude set nothing is filtered", () => {
    const burst = buildQueryBurst("laptop", ["laptop deals"], {
      rng: seqRng([0.99]),
      minSize: 3,
      maxSize: 3,
    });
    expect(burst).toEqual(["laptop", "laptop deals"]);
  });

  test("the seed is never duplicated inside its own burst", () => {
    const burst = buildQueryBurst("laptop", ["Laptop", "laptop deals"], {
      rng: seqRng([0.99]),
      minSize: 5,
      maxSize: 5,
    });
    const lowered = burst.map((q) => q.toLowerCase());
    expect(new Set(lowered).size).toBe(lowered.length);
  });
});

describe("fetchSuggestions", () => {
  test("returns normalized suggestions on a successful response", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(["tokyo", ["tokyo weather", "tokyo", "tokyo flights"]]),
      );
    const result = await fetchSuggestions("tokyo", { fetchImpl });
    expect(result).toEqual(["tokyo weather", "tokyo flights"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain("query=tokyo");
    expect(init.credentials).toBe("omit");
    expect(init.cache).toBe("no-store");
  });

  test("returns [] on a non-2xx response", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse([], false));
    expect(await fetchSuggestions("x", { fetchImpl })).toEqual([]);
  });

  test("returns [] when the network throws", async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error("offline"));
    expect(await fetchSuggestions("x", { fetchImpl })).toEqual([]);
  });

  test("returns [] when the body is not valid JSON", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    });
    expect(await fetchSuggestions("x", { fetchImpl })).toEqual([]);
  });

  test("returns [] when fetch resolves to nothing", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(undefined);
    expect(await fetchSuggestions("x", { fetchImpl })).toEqual([]);
  });

  test("does not call the network for an empty query", async () => {
    const fetchImpl = jest.fn();
    expect(await fetchSuggestions("", { fetchImpl })).toEqual([]);
    expect(await fetchSuggestions("   ", { fetchImpl })).toEqual([]);
    expect(await fetchSuggestions(null, { fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("returns [] when no fetch implementation is available", async () => {
    expect(await fetchSuggestions("x", { fetchImpl: null })).toEqual([]);
  });

  test("aborts and yields [] when the endpoint hangs past the timeout", async () => {
    const fetchImpl = jest.fn(
      (url, init) =>
        new Promise((resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );
    const result = await fetchSuggestions("slow", { fetchImpl, timeoutMs: 10 });
    expect(result).toEqual([]);
  });
});

describe("dynamic background topic sources", () => {
  test("builds locale-safe source URLs", () => {
    expect(new URL(buildGoogleTrendsUrl("vn")).searchParams.get("geo")).toBe(
      "VN",
    );
    expect(
      new URL(buildGoogleTrendsUrl("invalid")).searchParams.get("geo"),
    ).toBe("US");
    expect(
      buildWikipediaTopUrl("vi", new Date("2026-07-27T12:00:00Z")),
    ).toContain("/vi.wikipedia/all-access/2026/07/27");
  });

  test("parses Google Trends RSS item titles and XML entities", () => {
    const xml = `
      <rss><channel>
        <title>Feed title is not a topic</title>
        <item><title><![CDATA[AI &amp; robotics]]></title></item>
        <item><title>Vietnam football &#x32;026</title></item>
      </channel></rss>`;
    expect(parseGoogleTrendsRss(xml)).toEqual([
      "AI & robotics",
      "Vietnam football 2026",
    ]);
  });

  test("normalizes, filters and deduplicates topic names", () => {
    expect(
      normalizeTopicList([
        "  Space_exploration ",
        "space exploration",
        "Main Page",
        "Special:Search",
        "Trang_Chính",
        "Đặc_biệt:Tìm_kiếm",
        "AI",
      ]),
    ).toEqual(["Space exploration"]);
  });

  test("fetches Google Trends and Wikipedia topics independently", async () => {
    const googleFetch = jest
      .fn()
      .mockResolvedValue(
        textResponse(
          "<rss><channel><item><title>Trending topic</title></item></channel></rss>",
        ),
      );
    expect(
      await fetchGoogleTrends({ fetchImpl: googleFetch, regionCode: "VN" }),
    ).toEqual(["Trending topic"]);

    const wikiFetch = jest.fn().mockResolvedValue(
      jsonResponse({
        items: [
          {
            articles: [
              { article: "Machine_learning" },
              { article: "Main_Page" },
            ],
          },
        ],
      }),
    );
    expect(
      await fetchWikipediaTrending({
        fetchImpl: wikiFetch,
        languageCode: "en",
        date: new Date("2026-07-27T12:00:00Z"),
      }),
    ).toEqual(["Machine learning"]);
  });

  test("merges sources in alternating order and survives one failed source", async () => {
    const fetchImpl = jest.fn(async (url) => {
      if (url.includes("trends.google.com")) {
        return textResponse(
          "<rss><channel><item><title>Trend one</title></item><item><title>Trend two</title></item></channel></rss>",
        );
      }
      return jsonResponse({
        items: [
          {
            articles: [{ article: "Wiki_one" }, { article: "Wiki_two" }],
          },
        ],
      });
    });
    expect(
      await fetchDynamicTopics({
        fetchImpl,
        limit: 4,
        date: new Date("2026-07-27T12:00:00Z"),
      }),
    ).toEqual(["Trend one", "Wiki one", "Trend two", "Wiki two"]);

    const partialFetch = jest.fn(async (url) => {
      if (url.includes("trends.google.com")) throw new Error("blocked");
      return jsonResponse({
        items: [{ articles: [{ article: "Fallback_topic" }] }],
      });
    });
    expect(
      await fetchDynamicTopics({
        fetchImpl: partialFetch,
        date: new Date("2026-07-27T12:00:00Z"),
      }),
    ).toEqual(["Fallback topic"]);
  });

  test("drops a topic that trends on both sources at once", async () => {
    // The same story surfacing on Google and Wikipedia must not become two
    // searches for the same thing.
    const fetchImpl = jest.fn(async (url) => {
      if (url.includes("trends.google.com")) {
        return textResponse(
          "<rss><channel><item><title>Solar eclipse</title></item><item><title>Trend only</title></item></channel></rss>",
        );
      }
      return jsonResponse({
        items: [
          {
            articles: [{ article: "solar_eclipse" }, { article: "Wiki_only" }],
          },
        ],
      });
    });
    const topics = await fetchDynamicTopics({
      fetchImpl,
      date: new Date("2026-07-27T12:00:00Z"),
    });
    const lowered = topics.map((topic) => topic.toLowerCase());
    expect(new Set(lowered).size).toBe(lowered.length);
    expect(lowered).toContain("solar eclipse");
    expect(topics).toHaveLength(3);
  });

  test("honours the limit exactly when both sources are long", async () => {
    const fetchImpl = jest.fn(async (url) => {
      if (url.includes("trends.google.com")) {
        const items = Array.from(
          { length: 30 },
          (_, i) => `<item><title>Trend ${i}</title></item>`,
        ).join("");
        return textResponse(`<rss><channel>${items}</channel></rss>`);
      }
      return jsonResponse({
        items: [
          {
            articles: Array.from({ length: 30 }, (_, i) => ({
              article: `Wiki_${i}`,
            })),
          },
        ],
      });
    });
    expect(
      await fetchDynamicTopics({
        fetchImpl,
        limit: 7,
        date: new Date("2026-07-27T12:00:00Z"),
      }),
    ).toHaveLength(7);
  });
});

describe("dynamic topic cache", () => {
  test("returns a fresh normalized cache and rejects stale/future values", () => {
    const now = 1000000;
    const cache = createDynamicTopicCache(
      ["Topic_one", "topic one", "Topic two"],
      now,
    );
    expect(readFreshDynamicTopicCache(cache, now + 1000, 5000)).toEqual([
      "Topic one",
      "Topic two",
    ]);
    expect(readFreshDynamicTopicCache(cache, now + 6000, 5000)).toEqual([]);
    expect(readFreshDynamicTopicCache(cache, now - 1, 5000)).toEqual([]);
    expect(readFreshDynamicTopicCache(null, now, 5000)).toEqual([]);
  });

  test("only reuses a cache created for the requested locale", () => {
    const now = 1000000;
    const cache = createDynamicTopicCache(["Chủ đề Việt Nam"], now, {
      languageCode: "vi",
      regionCode: "VN",
    });
    expect(
      readFreshDynamicTopicCache(cache, now + 1000, 5000, {
        languageCode: "vi",
        regionCode: "VN",
      }),
    ).toEqual(["Chủ đề Việt Nam"]);
    expect(
      readFreshDynamicTopicCache(cache, now + 1000, 5000, {
        languageCode: "en",
        regionCode: "US",
      }),
    ).toEqual([]);
  });
});

const { loadEsmModule } = require("./esm-loader.js");

const {
  normalizeSearchPlan,
  hasSearchWork,
  queryTemplateKey,
  chooseSearchTemplate,
  DEFAULT_SEARCH_DELAY_MIN,
  DEFAULT_SEARCH_DELAY_MAX,
  MINIMUM_SEARCH_DELAY,
} = loadEsmModule("../js/search-plan.js");

describe("normalizeSearchPlan", () => {
  test("applies defaults when fields are missing", () => {
    const plan = normalizeSearchPlan({});
    expect(plan).toMatchObject({
      desk: 0,
      mob: 0,
      min: DEFAULT_SEARCH_DELAY_MIN,
      max: DEFAULT_SEARCH_DELAY_MAX,
    });
  });

  test("clamps negative counts to zero", () => {
    const plan = normalizeSearchPlan({ desk: -5, mob: -1 });
    expect(plan.desk).toBe(0);
    expect(plan.mob).toBe(0);
  });

  test("floors min delay at MINIMUM_SEARCH_DELAY", () => {
    expect(normalizeSearchPlan({ min: 1 }).min).toBe(MINIMUM_SEARCH_DELAY);
  });

  test("raises max to min when max < min", () => {
    const plan = normalizeSearchPlan({ min: 20, max: 10 });
    expect(plan.min).toBe(20);
    expect(plan.max).toBe(20);
  });

  test("keeps valid values and passes through unknown fields", () => {
    const plan = normalizeSearchPlan({
      desk: 30,
      mob: 20,
      min: 8,
      max: 15,
      mode: "m3",
    });
    expect(plan).toMatchObject({
      desk: 30,
      mob: 20,
      min: 8,
      max: 15,
      mode: "m3",
    });
  });

  test("honours custom bounds", () => {
    const plan = normalizeSearchPlan(
      {},
      { defaultMin: 3, defaultMax: 6, minimum: 2 },
    );
    expect(plan.min).toBe(3);
    expect(plan.max).toBe(6);
    expect(normalizeSearchPlan({ min: 1 }, { minimum: 2 }).min).toBe(2);
  });
});

describe("hasSearchWork", () => {
  test("true when either count is positive", () => {
    expect(hasSearchWork({ desk: 1, mob: 0 })).toBe(true);
    expect(hasSearchWork({ desk: 0, mob: 5 })).toBe(true);
  });

  test("false when both zero or missing", () => {
    expect(hasSearchWork({ desk: 0, mob: 0 })).toBe(false);
    expect(hasSearchWork({})).toBe(false);
  });
});

describe("queryTemplateKey", () => {
  test("is niche-scoped and lowercased", () => {
    expect(queryTemplateKey("tech", "Best Gadgets")).toBe("tech:best gadgets");
  });
});

describe("chooseSearchTemplate", () => {
  const queries = { tech: ["A", "B", "C"] };

  test("returns empty string for unknown/empty niche", () => {
    expect(chooseSearchTemplate("nope", queries, new Set())).toBe("");
  });

  test("marks the chosen template as used", () => {
    const used = new Set();
    const chosen = chooseSearchTemplate("tech", queries, used);
    expect(queries.tech).toContain(chosen);
    expect(used.has(queryTemplateKey("tech", chosen))).toBe(true);
  });

  test("does not repeat until the niche pool is exhausted", () => {
    const used = new Set();
    const picks = new Set();
    for (let i = 0; i < 3; i++) {
      picks.add(chooseSearchTemplate("tech", queries, used));
    }
    // All three distinct templates used exactly once before any repeat.
    expect(picks.size).toBe(3);
  });

  test("resets only its own niche's history when exhausted", () => {
    const used = new Set(["other:x"]);
    for (let i = 0; i < 5; i++) chooseSearchTemplate("tech", queries, used);
    // The unrelated niche key survives the reset.
    expect(used.has("other:x")).toBe(true);
  });
});

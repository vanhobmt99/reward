"use strict";

const fs = require("fs");
const path = require("path");

function loadQueries() {
  const raw = fs.readFileSync(
    path.resolve(__dirname, "../js/queries.js"),
    "utf8",
  );
  const normalized = raw
    .replace(/^const\s+queries=/, "const queries=")
    .replace(/export\s*\{\s*queries\s*\}\s*;?\s*$/, "return queries;");
  return new Function(`${normalized}`)();
}

function loadQueriesExtra() {
  const raw = fs.readFileSync(
    path.resolve(__dirname, "../js/queries_extra.js"),
    "utf8",
  );
  const normalized = raw.replace(/^export\s+const\s+/, "const ");
  return new Function(`${normalized}; return queriesExtra;`)();
}

function loadOptionsNicheOptions() {
  const html = fs.readFileSync(
    path.resolve(__dirname, "../options.html"),
    "utf8",
  );
  const selectMatch = html.match(
    /<select[^>]*id="niche"[^>]*>([\s\S]*?)<\/select>/i,
  );
  if (!selectMatch) return [];
  return [...selectMatch[1].matchAll(/<option\s+value="([^"]+)"/gi)].map(
    (match) => match[1],
  );
}

describe("options page Search Niche options", () => {
  test("provides the default background topic mode", () => {
    const html = fs.readFileSync(
      path.resolve(__dirname, "../options.html"),
      "utf8",
    );
    const script = fs.readFileSync(
      path.resolve(__dirname, "../js/options.js"),
      "utf8",
    );
    expect(html).toMatch(/<option\s+value="random">/i);
    expect(script).toMatch(/config\.control\.niche\s*\|\|\s*"random"/);
  });

  test("matches runtime query categories", () => {
    const runtimeQueries = { ...loadQueries(), ...loadQueriesExtra() };
    const runtimeCategories = Object.keys(runtimeQueries).sort();
    const options = loadOptionsNicheOptions().sort();
    expect(options.filter((option) => option !== "random")).toEqual(
      runtimeCategories.filter((category) => category !== "random"),
    );
    expect(options).toContain("random");
  });
});

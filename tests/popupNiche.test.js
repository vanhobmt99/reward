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

function loadPopupNicheOptions() {
  const html = fs.readFileSync(
    path.resolve(__dirname, "../popup.html"),
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

describe("popup Search Niche options", () => {
  test("defaults to the background topic mode", () => {
    const html = fs.readFileSync(
      path.resolve(__dirname, "../popup.html"),
      "utf8",
    );
    expect(html).toMatch(
      /<option\s+value="random"\s+selected>Theo chủ đề \(mặc định\)<\/option>/i,
    );
  });

  test("match runtime query categories", () => {
    const runtimeQueries = { ...loadQueries(), ...loadQueriesExtra() };
    const runtimeCategories = Object.keys(runtimeQueries).sort();
    const popupOptions = loadPopupNicheOptions().sort();

    const concretePopup = popupOptions.filter((option) => option !== "random");
    const concreteRuntime = runtimeCategories.filter(
      (category) => category !== "random",
    );
    expect(concretePopup).toEqual(concreteRuntime);
    expect(popupOptions).toContain("random");
  });
});

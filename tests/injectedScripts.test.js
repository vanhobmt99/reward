/**
 * @jest-environment jsdom
 */

const { loadEsmModule } = require("./esm-loader.js");

const {
  createDashboardActivityScript,
  createEarnActivityScript,
  createSolveActivityScript,
  createClaimReadyScript,
  createResultPickScript,
} = loadEsmModule("../js/injected-scripts.js");

// Compile (but never invoke) a script string to assert it is syntactically
// valid JavaScript. new Function() throws on parse errors without running the
// body, so this catches a broken extraction/template without touching the DOM.
function assertCompiles(scriptString) {
  expect(() => new Function(scriptString)).not.toThrow();
}

describe("createDashboardActivityScript", () => {
  test("produces syntactically valid JS", () => {
    assertCompiles(createDashboardActivityScript(["a", "b"], 1));
  });

  test("embeds visited keys and safety limit", () => {
    const script = createDashboardActivityScript(["daily poll", "news"], 3);
    expect(script).toContain(JSON.stringify(["daily poll", "news"]));
    expect(script).toContain("const safetyLimit = 3;");
  });

  test("defaults safety limit when omitted", () => {
    expect(createDashboardActivityScript([])).toContain(
      "const safetyLimit = 12;",
    );
  });

  test("guards against a non-numeric safety limit", () => {
    expect(createDashboardActivityScript([], "oops")).toContain(
      "const safetyLimit = 12;",
    );
  });

  test("returns a CDP press point for a Daily Set card without synthetic click", () => {
    document.body.innerHTML = `
      <main>
        <h2>Daily set</h2>
        <a class="daily-card" href="https://rewards.bing.com/quiz">+10 Start quiz</a>
        <h2>Your activity</h2>
      </main>`;
    const heading = document.querySelector("h2");
    const card = document.querySelector("a");
    const nextHeading = document.querySelectorAll("h2")[1];
    heading.getBoundingClientRect = () => ({
      width: 200,
      height: 30,
      top: 10,
      bottom: 40,
      left: 0,
      right: 200,
    });
    card.getBoundingClientRect = () => ({
      width: 220,
      height: 70,
      top: 60,
      bottom: 130,
      left: 20,
      right: 240,
    });
    nextHeading.getBoundingClientRect = () => ({
      width: 200,
      height: 30,
      top: 180,
      bottom: 210,
      left: 0,
      right: 200,
    });
    card.scrollIntoView = () => {};
    document.elementFromPoint = jest.fn(() => card);
    card.click = jest.fn();

    const script = createDashboardActivityScript([], 1, true);
    const result = new Function("return (" + script + ")")();

    expect(result.clicked).toHaveLength(1);
    expect(result.pressPoint).toEqual({ x: 130, y: 95 });
    expect(card.click).not.toHaveBeenCalled();
  });
});

describe("createEarnActivityScript", () => {
  test("produces syntactically valid JS", () => {
    assertCompiles(createEarnActivityScript(["x"], 2));
  });

  test("embeds visited keys and safety limit", () => {
    const script = createEarnActivityScript(["quiz"], 4);
    expect(script).toContain(JSON.stringify(["quiz"]));
    expect(script).toContain("const safetyLimit = 4;");
  });

  // jsdom has no layout, so every element under test gets a faked box and the
  // shared elementFromPoint/click stubs, mirroring the Dashboard functional test.
  function stageEarnCard(cardHtml) {
    document.body.innerHTML = `
      <main>
        <h2>Keep earning</h2>
        ${cardHtml}
      </main>`;
    const heading = document.querySelector("h2");
    const card = document.querySelector("a");
    heading.getBoundingClientRect = () => ({
      width: 200,
      height: 30,
      top: 10,
      bottom: 40,
      left: 0,
      right: 200,
    });
    card.getBoundingClientRect = () => ({
      width: 220,
      height: 70,
      top: 60,
      bottom: 130,
      left: 20,
      right: 240,
    });
    card.scrollIntoView = () => {};
    document.elementFromPoint = jest.fn(() => card);
    card.click = jest.fn();
    return card;
  }

  test("clicks a Keep-earning card that shows points", () => {
    const card = stageEarnCard(
      `<a class="earn-card" href="https://rewards.bing.com/quiz">+10 Start quiz</a>`,
    );
    const script = createEarnActivityScript([], 3);
    const result = new Function("return (" + script + ")")();

    expect(result.clicked).toHaveLength(1);
    expect(result.clicked[0].type).toBe("keep-earning");
    expect(card.click).toHaveBeenCalled();
  });

  test("returns a CDP press point for a Keep-earning card without synthetic click", () => {
    const card = stageEarnCard(
      `<a class="earn-card" href="https://rewards.bing.com/quiz">+10 Start quiz</a>`,
    );
    const script = createEarnActivityScript([], 1, true);
    const result = new Function("return (" + script + ")")();

    expect(result.clicked).toHaveLength(1);
    expect(result.clicked[0].type).toBe("keep-earning");
    expect(result.pressPoint).toEqual({ x: 130, y: 95 });
    expect(card.click).not.toHaveBeenCalled();
  });

  test("skips a completed Keep-earning card without clicking", () => {
    const card = stageEarnCard(
      `<a class="earn-card" href="https://rewards.bing.com/quiz">+10 Completed quiz</a>`,
    );
    const script = createEarnActivityScript([], 3);
    const result = new Function("return (" + script + ")")();

    expect(result.clicked).toHaveLength(0);
    expect(result.skipped.some((s) => s.reason === "already completed")).toBe(
      true,
    );
    expect(card.click).not.toHaveBeenCalled();
  });

  test("respects already-visited keys", () => {
    const card = stageEarnCard(
      `<a class="earn-card" href="https://rewards.bing.com/quiz">+10 Start quiz</a>`,
    );
    // The card's key is its href; pre-seeding it must suppress the click.
    const script = createEarnActivityScript(
      ["https://rewards.bing.com/quiz"],
      3,
    );
    const result = new Function("return (" + script + ")")();

    expect(result.clicked).toHaveLength(0);
    expect(card.click).not.toHaveBeenCalled();
  });
});

describe("createSolveActivityScript", () => {
  test("produces syntactically valid JS", () => {
    assertCompiles(createSolveActivityScript());
  });

  test("returns an immediately-invoked function expression string", () => {
    const script = createSolveActivityScript();
    expect(script).toContain("(function()");
    expect(script).toContain("})()");
  });
});

describe("createClaimReadyScript", () => {
  test("produces syntactically valid JS", () => {
    assertCompiles(createClaimReadyScript());
  });

  test("matches the ready-to-claim card and returns a click result shape", () => {
    const script = createClaimReadyScript();
    expect(script).toMatch(/ready to claim/i);
    expect(script).toContain("clicked:");
    expect(script).toContain("count:");
  });

  test("evaluates to a no-op result when there is no claim UI (jsdom)", () => {
    // Run the IIFE against an empty jsdom document: no card, no crash.
    const script = createClaimReadyScript();
    // Parenthesise to avoid ASI (the script body starts with a newline).
    const result = new Function("return (" + script + ")")();
    expect(result).toMatchObject({ clicked: false });
  });

  test("clicks the ready-to-claim card and reads the pending count", () => {
    // Mirrors the real dashboard card: a button labelled "Ready to claim" with
    // the pending count and a "Claim" affordance.
    document.body.innerHTML = `
      <button aria-expanded="false">
        <p>Ready to claim</p>
        <p>6</p>
        <p>Claim</p>
      </button>`;
    const btn = document.querySelector("button");
    // jsdom has no layout, so fake a visible box and capture the click.
    btn.getBoundingClientRect = () => ({
      width: 120,
      height: 40,
      top: 0,
      bottom: 40,
      left: 0,
      right: 120,
    });
    btn.scrollIntoView = () => {};
    let clicked = false;
    btn.click = () => {
      clicked = true;
    };

    const script = createClaimReadyScript();
    const result = new Function("return (" + script + ")")();

    expect(clicked).toBe(true);
    expect(result).toMatchObject({ clicked: true, count: 6 });
  });

  test('clicks a standalone "Claim points" confirm button', () => {
    // The confirm control that appears after opening the card (real text).
    document.body.innerHTML = `<button><span>Claim points</span></button>`;
    const btn = document.querySelector("button");
    btn.getBoundingClientRect = () => ({
      width: 140,
      height: 40,
      top: 0,
      bottom: 40,
      left: 0,
      right: 140,
    });
    btn.scrollIntoView = () => {};
    let clicked = false;
    btn.click = () => {
      clicked = true;
    };

    const script = createClaimReadyScript();
    const result = new Function("return (" + script + ")")();

    expect(clicked).toBe(true);
    expect(result).toMatchObject({ clicked: true });
  });

  test("finds a React Aria claim control in a dialog and defers to CDP", () => {
    document.body.innerHTML = `
      <div role="dialog">
        <div data-react-aria-pressable tabindex="0"><span>Claim points</span></div>
      </div>`;
    const dialog = document.querySelector('[role="dialog"]');
    const control = document.querySelector("[data-react-aria-pressable]");
    dialog.getBoundingClientRect = () => ({
      width: 300,
      height: 200,
      top: 0,
      bottom: 200,
      left: 0,
      right: 300,
    });
    control.getBoundingClientRect = () => ({
      width: 140,
      height: 40,
      top: 50,
      bottom: 90,
      left: 30,
      right: 170,
    });
    control.scrollIntoView = () => {};
    control.click = jest.fn();

    const script = createClaimReadyScript(true);
    const result = new Function("return (" + script + ")")();

    expect(result).toMatchObject({
      clicked: true,
      stage: "confirm",
      pressPoint: { x: 100, y: 70 },
    });
    expect(control.click).not.toHaveBeenCalled();
  });
});

describe("createResultPickScript", () => {
  test("produces syntactically valid JS", () => {
    assertCompiles(createResultPickScript());
  });

  // jsdom has no layout, so each link gets a faked in-viewport box.
  function stageSerp(html, boxes = {}) {
    document.body.innerHTML = html;
    window.innerHeight = 800;
    for (const link of document.querySelectorAll("a")) {
      const box = boxes[link.getAttribute("href")] || {
        width: 300,
        height: 24,
        top: 100,
        bottom: 124,
        left: 40,
        right: 340,
      };
      link.getBoundingClientRect = () => box;
    }
    for (const item of document.querySelectorAll("li")) {
      item.getBoundingClientRect = () => ({
        width: 600,
        height: 90,
        top: 90,
        bottom: 180,
        left: 20,
        right: 620,
      });
    }
  }

  function run() {
    return new Function("return (" + createResultPickScript() + ")")();
  }

  test("returns the centre point of an organic result", () => {
    stageSerp(
      '<div id="b_results"><li class="b_algo"><h2>' +
        '<a href="https://example.com/article">Example article</a>' +
        "</h2></li></div>",
    );
    expect(run()).toMatchObject({
      found: true,
      x: 190,
      y: 112,
      title: "Example article",
      total: 1,
    });
  });

  test("reports not-found when the results container is missing", () => {
    document.body.innerHTML = "<div>no serp here</div>";
    expect(run()).toEqual({ found: false, reason: "no-results-container" });
  });

  test("skips ads", () => {
    stageSerp(
      '<div id="b_results">' +
        '<li class="b_algo b_ad"><h2><a href="https://ad.example/x">Ad</a></h2></li>' +
        "</div>",
    );
    expect(run()).toEqual({ found: false, reason: "no-candidates" });
  });

  test("skips answer/PAA blocks", () => {
    stageSerp(
      '<div id="b_results"><div class="b_ans">' +
        '<li class="b_algo"><h2><a href="https://example.com/paa">PAA</a></h2></li>' +
        "</div></div>",
    );
    expect(run()).toEqual({ found: false, reason: "no-candidates" });
  });

  test("skips Microsoft-owned destinations", () => {
    // Visiting rewards/login would disturb the very session being used.
    stageSerp(
      '<div id="b_results">' +
        '<li class="b_algo"><h2><a href="https://rewards.bing.com/x">Rewards</a></h2></li>' +
        '<li class="b_algo"><h2><a href="https://www.microsoft.com/y">MS</a></h2></li>' +
        '<li class="b_algo"><h2><a href="https://msn.com/z">MSN</a></h2></li>' +
        "</div>",
    );
    expect(run()).toEqual({ found: false, reason: "no-candidates" });
  });

  test("accepts a bing /ck/a wrapper, which is how organic links are served", () => {
    stageSerp(
      '<div id="b_results"><li class="b_algo"><h2>' +
        '<a href="https://www.bing.com/ck/a?!&p=1&u=aHR0cHM6Ly9leGFtcGxlLmNvbQ">Wrapped</a>' +
        "</h2></li></div>",
    );
    expect(run()).toMatchObject({ found: true, title: "Wrapped" });
  });

  test("skips non-http schemes", () => {
    stageSerp(
      '<div id="b_results">' +
        '<li class="b_algo"><h2><a href="javascript:void(0)">JS</a></h2></li>' +
        '<li class="b_algo"><h2><a href="#anchor">Anchor</a></h2></li>' +
        "</div>",
    );
    expect(run()).toEqual({ found: false, reason: "no-candidates" });
  });

  test("skips links scrolled outside the viewport", () => {
    // Pressing coordinates that are off-screen would land on whatever else is
    // at that point instead of the intended result.
    stageSerp(
      '<div id="b_results"><li class="b_algo"><h2>' +
        '<a href="https://example.com/below">Below the fold</a>' +
        "</h2></li></div>",
      {
        "https://example.com/below": {
          width: 300,
          height: 24,
          top: 1200,
          bottom: 1224,
          left: 40,
          right: 340,
        },
      },
    );
    expect(run()).toEqual({ found: false, reason: "no-candidates" });
  });

  test("reports whether the link opens in a new tab", () => {
    stageSerp(
      '<div id="b_results"><li class="b_algo"><h2>' +
        '<a href="https://example.com/new" target="_BLANK">New tab</a>' +
        "</h2></li></div>",
    );
    expect(run()).toMatchObject({ found: true, newTab: true });
  });

  test("only ever picks from the top five results", () => {
    const items = Array.from(
      { length: 12 },
      (_, i) =>
        '<li class="b_algo"><h2><a href="https://example.com/r' +
        i +
        '">Result ' +
        i +
        "</a></h2></li>",
    ).join("");
    stageSerp('<div id="b_results">' + items + "</div>");
    const titles = new Set();
    for (let i = 0; i < 200; i++) titles.add(run().title);
    expect(titles.size).toBeGreaterThan(1);
    for (const title of titles) {
      expect(Number(title.split(" ")[1])).toBeLessThan(5);
    }
  });

  test("never clicks page-side; it only reports a point", () => {
    stageSerp(
      '<div id="b_results"><li class="b_algo"><h2>' +
        '<a href="https://example.com/a">A</a>' +
        "</h2></li></div>",
    );
    const link = document.querySelector("a");
    link.click = jest.fn();
    run();
    expect(link.click).not.toHaveBeenCalled();
  });
});

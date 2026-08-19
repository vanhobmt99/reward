/**
 * @jest-environment jsdom
 */

const { loadEsmModule } = require("./esm-loader.js");

const {
  createDashboardActivityScript,
  createEarnActivityScript,
  createSolveActivityScript,
  createClaimReadyScript,
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

  test("does not claim a Daily Set click when an overlay covers the card", () => {
    document.body.innerHTML = `
      <main>
        <h2>Daily set</h2>
        <a class="daily-card" href="https://rewards.bing.com/quiz">+10 Start quiz</a>
        <h2>Your activity</h2>
        <div id="overlay"></div>
      </main>`;
    const [heading, nextHeading] = document.querySelectorAll("h2");
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
    nextHeading.getBoundingClientRect = () => ({
      width: 200,
      height: 30,
      top: 180,
      bottom: 210,
      left: 0,
      right: 200,
    });
    card.scrollIntoView = () => {};
    card.click = jest.fn();
    document.elementFromPoint = jest.fn(() =>
      document.querySelector("#overlay"),
    );

    const result = new Function(
      "return (" + createDashboardActivityScript([], 1, true) + ")",
    )();

    expect(result.clicked).toHaveLength(0);
    expect(result.openedKeys).toHaveLength(0);
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

  test("returns a trusted press point without synthetic click", () => {
    document.body.innerHTML = `<button data-testid="answer-0">Answer A</button>`;
    const button = document.querySelector("button");
    button.getBoundingClientRect = () => ({
      width: 160,
      height: 40,
      top: 50,
      bottom: 90,
      left: 20,
      right: 180,
    });
    button.scrollIntoView = () => {};
    button.click = jest.fn();
    document.elementFromPoint = jest.fn(() => button);

    const result = new Function(
      "return (" + createSolveActivityScript(true) + ")",
    )();

    expect(result).toMatchObject({
      clicked: true,
      text: "Answer A",
      pressPoint: { x: 100, y: 70 },
    });
    expect(button.click).not.toHaveBeenCalled();
  });

  test("refuses a solver click when another element covers the target", () => {
    document.body.innerHTML = `<button data-testid="answer-0">Answer A</button><div id="overlay"></div>`;
    const button = document.querySelector("button");
    button.getBoundingClientRect = () => ({
      width: 160,
      height: 40,
      top: 50,
      bottom: 90,
      left: 20,
      right: 180,
    });
    button.scrollIntoView = () => {};
    button.click = jest.fn();
    document.elementFromPoint = jest.fn(() =>
      document.querySelector("#overlay"),
    );

    const result = new Function(
      "return (" + createSolveActivityScript(true) + ")",
    )();

    expect(result).toMatchObject({
      clicked: false,
      reason: "target covered or moved",
    });
    expect(button.click).not.toHaveBeenCalled();
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

// Markup copied from a saved rewards.bing.com page (2026 React/Tailwind UI).
// The reward value is a BARE number in a pill badge — there is no "points"/"pts"
// word anywhere on the card, which is what the text-only patterns used to miss.
function realRewardsCard(title, subtitle, badge, status = "") {
  return `
    <a class="group/ctrl cursor-pointer rounded-cornerCardDefault"
       href="https://www.bing.com/search?q=Trip+to+Boston&FORM=tgrew4"
       target="_blank" rel="noopener noreferrer" tabindex="0" data-react-aria-pressable="true">
      <div class="flex size-full gap-gapBetweenContentSmall p-paddingCardDefault overflow-hidden rounded-cornerCardDefault bg-bgCardOnPrimaryDefaultRest cursor-pointer flex-row">
        <div class="flex grow flex-col p-paddingCardBodyDefaultOutside gap-2">
          <div class="flex grow flex-col gap-0.5">
            <p class="line-clamp-3 text-globalBody2Strong">${title}</p>
            <p class="line-clamp-3 text-fgCtrlNeutralSecondaryRest">${subtitle}</p>
          </div>
          <div class="flex w-full items-center gap-2">
            <div class="flex h-5 w-fit min-w-5 shrink-0 items-center justify-center gap-0.5 rounded-cornerCircular px-1.5 bg-statusSuccessRewardsBg text-fgCtrlOnImage">
              <svg viewBox="0 0 7 6" class="size-2 text-fgCtrlOnImage"></svg>
              <p class="text-metadata text-fgCtrlOnImage">${badge}</p>
            </div>
            <div class="flex grow items-center justify-end gap-0.5">
              <div class="line-clamp-2 text-end text-metadata text-fgCtrlNeutralSecondaryRest">${status}</div>
            </div>
          </div>
        </div>
      </div>
    </a>`;
}

describe("live rewards.bing.com markup", () => {
  test("Keep earning clicks a card whose points are a bare badge number", () => {
    document.body.innerHTML = `
      <main>
        <h2>Keep earning</h2>
        ${realRewardsCard("Quote of the day", "Start your day with a quote", "5")}
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
      width: 320,
      height: 120,
      top: 60,
      bottom: 180,
      left: 20,
      right: 340,
    });
    card.scrollIntoView = () => {};
    document.elementFromPoint = jest.fn(() => card);
    card.click = jest.fn();

    const result = new Function(
      "return (" + createEarnActivityScript([], 3) + ")",
    )();

    expect(result.skipped.some((s) => s.reason === "no visible points")).toBe(
      false,
    );
    expect(result.clicked).toHaveLength(1);
    expect(card.click).toHaveBeenCalled();
  });

  test("Keep earning still skips a completed bare-badge card", () => {
    document.body.innerHTML = `
      <main>
        <h2>Keep earning</h2>
        ${realRewardsCard("Quote of the day", "Start your day with a quote", "5", "Completed")}
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
      width: 320,
      height: 120,
      top: 60,
      bottom: 180,
      left: 20,
      right: 340,
    });
    card.scrollIntoView = () => {};
    document.elementFromPoint = jest.fn(() => card);
    card.click = jest.fn();

    const result = new Function(
      "return (" + createEarnActivityScript([], 3) + ")",
    )();

    expect(result.clicked).toHaveLength(0);
    expect(card.click).not.toHaveBeenCalled();
  });

  test("Daily set asks for another scroll when its cards are below the fold", () => {
    // The heading enters the viewport at its BOTTOM edge, so every card under it
    // is still off-screen. The pass must scroll instead of reporting nothing.
    document.body.innerHTML = `
      <main>
        <h2>Daily set</h2>
        ${realRewardsCard("Boston harbor summer sailboats", "Sailboats and seafood", "10")}
      </main>`;
    const heading = document.querySelector("h2");
    const card = document.querySelector("a");
    heading.getBoundingClientRect = () => ({
      width: 200,
      height: 30,
      top: window.innerHeight - 28,
      bottom: window.innerHeight - 2,
      left: 0,
      right: 200,
    });
    card.getBoundingClientRect = () => ({
      width: 320,
      height: 120,
      top: window.innerHeight + 40,
      bottom: window.innerHeight + 160,
      left: 20,
      right: 340,
    });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      value: window.innerHeight * 4,
      configurable: true,
    });
    window.scrollBy = jest.fn();

    const result = new Function(
      "return (" + createDashboardActivityScript([], 1, true) + ")",
    )();

    expect(result.retry).toBe(true);
    expect(result.reason).toMatch(/scrolled for more Daily set cards/i);
    expect(window.scrollBy).toHaveBeenCalled();
  });

  test("claim reads a thousands-separated pending count", () => {
    document.body.innerHTML = `
      <div data-react-aria-pressable tabindex="0">
        <p>Ready to claim</p>
        <p>1,250</p>
        <p>Claim</p>
      </div>`;
    const cardEl = document.querySelector("[data-react-aria-pressable]");
    cardEl.getBoundingClientRect = () => ({
      width: 120,
      height: 40,
      top: 0,
      bottom: 40,
      left: 0,
      right: 120,
    });
    cardEl.scrollIntoView = () => {};
    cardEl.click = jest.fn();

    const result = new Function(
      "return (" + createClaimReadyScript(true) + ")",
    )();

    expect(result).toMatchObject({ clicked: true, count: 1250 });
  });

  test("claim still short-circuits when the card also shows a points balance", () => {
    // A wrapper that carries both "Available points 3,549" and "Ready to claim 0"
    // must not report 549 pending and go hunting for a confirm button.
    document.body.innerHTML = `
      <div data-react-aria-pressable tabindex="0">
        <p>Available points</p>
        <p>3,549</p>
        <p>Ready to claim</p>
        <p>0</p>
        <p>Claim</p>
      </div>`;
    const cardEl = document.querySelector("[data-react-aria-pressable]");
    cardEl.getBoundingClientRect = () => ({
      width: 120,
      height: 40,
      top: 0,
      bottom: 40,
      left: 0,
      right: 120,
    });
    cardEl.scrollIntoView = () => {};
    cardEl.click = jest.fn();

    const result = new Function(
      "return (" + createClaimReadyScript(true) + ")",
    )();

    expect(result).toMatchObject({ clicked: false, count: 0 });
    expect(cardEl.click).not.toHaveBeenCalled();
  });
});

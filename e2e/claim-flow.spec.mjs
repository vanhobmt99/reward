import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

// The extension keeps its page-side code as an ES module while this repository
// is CommonJS by default. Importing it from a data URL lets this browser test
// exercise the exact generated script shipped by the extension.
const injectedScriptSource = await readFile(
  new URL("../js/injected-scripts.js", import.meta.url),
  "utf8",
);
const {
  createClaimReadyScript,
  createEarnActivityScript,
  createDailySetStateProbe,
} = await import(
  `data:text/javascript,${encodeURIComponent(injectedScriptSource)}`
);

test("Daily set verification rejects skeletons and partial completion", async ({
  page,
}) => {
  await page.setContent(`<main>
    <section><h2>Daily set</h2><div class="animate-pulse">Loading</div></section>
    <div hidden><section><h2>Daily set</h2><a href="/old">10 Completed</a></section></div>
  </main>`);
  expect(await page.evaluate(createDailySetStateProbe())).toMatchObject({
    status: "loading",
  });
  await page.locator("main > section").evaluate((el) => {
    el.innerHTML =
      '<h2>Daily set</h2><a href="/a">10 Completed</a><a href="/b">+10 Sydney</a><a href="/c">+10 Quiz</a>';
  });
  expect(await page.evaluate(createDailySetStateProbe())).toMatchObject({
    status: "pending",
    done: 1,
    total: 3,
  });
  await page
    .locator('a[href="/b"]')
    .evaluate((el) => (el.textContent = "10 Completed"));
  await page
    .locator('a[href="/c"]')
    .evaluate((el) => (el.textContent = "10 Completed"));
  expect(await page.evaluate(createDailySetStateProbe())).toMatchObject({
    status: "complete",
    done: 3,
    total: 3,
  });
  await page.locator('a[href="/c"]').evaluate((el) => el.remove());
  expect(await page.evaluate(createDailySetStateProbe())).toMatchObject({
    status: "unknown",
  });
});

test("Keep earning is scanned when a separate Quests section precedes it", async ({
  page,
}) => {
  await page.setContent(`
    <main>
      <section><h2>Quests</h2>
        <a href="https://rewards.bing.com/earn/quest/completed" style="display:block;width:350px;height:100px">Search quest 100 points 4/4 tasks</a>
      </section>
      <section><h2>Keep earning</h2>
        <a id="quote" href="https://www.bing.com/search?q=quote" style="display:block;width:350px;height:100px">Have you heard this quote? +5</a>
      </section>
    </main>
  `);
  const result = await page.evaluate(createEarnActivityScript([], 1, true));
  expect(result.openedKeys).toEqual(["https://www.bing.com/search?q=quote"]);
  expect(result.clicked).toHaveLength(1);
  expect(result.pressPoint).toBeTruthy();
});

test("claims pending points after search through the real pointer flow", async ({
  page,
}) => {
  await page.setContent(`
    <main>
      <div style="height: 1100px">Search results have finished loading.</div>
      <button id="ready-card" data-react-aria-pressable="true">
        <span>Ready to claim</span><strong id="pending">6</strong><span>Claim</span>
      </button>
      <p id="balance">Available points: 120</p>
    </main>
    <script>
      const card = document.querySelector('#ready-card');
      card.addEventListener('click', () => {
        const dialog = document.createElement('div');
        dialog.id = 'claim-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.innerHTML = '<button id="claim-points" data-react-aria-pressable="true">Claim points</button>';
        document.body.append(dialog);
        document.querySelector('#claim-points').addEventListener('click', () => {
          document.querySelector('#pending').textContent = '0';
          document.querySelector('#balance').textContent = 'Available points: 126';
          dialog.remove();
        });
      });
    </script>
  `);

  // The extension's first evaluation only locates a safe CDP press point; the
  // browser mouse is what performs the trusted press in production.
  const open = await page.evaluate(createClaimReadyScript(true, false));
  expect(open).toMatchObject({ clicked: true, stage: "open", count: 6 });
  await page.mouse.click(open.pressPoint.x, open.pressPoint.y);
  await expect(page.getByRole("dialog")).toBeVisible();

  const confirm = await page.evaluate(createClaimReadyScript(true, true));
  expect(confirm).toMatchObject({ clicked: true, stage: "confirm", count: 6 });
  await page.mouse.click(confirm.pressPoint.x, confirm.pressPoint.y);

  await expect(page.locator("#pending")).toHaveText("0");
  await expect(page.locator("#balance")).toHaveText("Available points: 126");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const finished = await page.evaluate(createClaimReadyScript(true, true));
  expect(finished).toMatchObject({
    clicked: false,
    count: 0,
    reason: "nothing pending",
  });
});

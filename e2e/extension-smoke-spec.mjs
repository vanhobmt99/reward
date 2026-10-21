import {test, expect, chromium} from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import chromeBuilder from '../scripts/build-chrome.cjs';
import storageSmoke from '../scripts/storage-smoke.cjs';

// Use an isolated profile and Playwright's bundled Chromium for MV3 support:
// https://playwright.dev/docs/chrome-extensions
test(
    'packaged Chrome extension initializes and keeps diagnostics opt-in',
    async () => {
      const temporary =
          fs.mkdtempSync(path.join(os.tmpdir(), 'search-auto-chrome-smoke-'));
      if (path.dirname(temporary) !== path.resolve(os.tmpdir()) ||
          !path.basename(temporary).startsWith('search-auto-chrome-smoke-')) {
        throw new Error('Unexpected Chrome smoke directory');
      }
      let context;
      try {
        const extension =
            chromeBuilder.buildChrome(path.join(temporary, 'extension'));
        context = await chromium.launchPersistentContext(
            path.join(temporary, 'profile'), {
              channel: 'chromium',
              headless: true,
              args: [
                `--disable-extensions-except=${extension}`,
                `--load-extension=${extension}`,
              ],
            });
        const worker = context.serviceWorkers()[0] ||
            await context.waitForEvent('serviceworker');
        const origin = new URL(worker.url()).origin;
        // Non-special schemes have a null URL.origin.
        const base = origin === 'null' ?
            `chrome-extension://${new URL(worker.url()).host}` :
            origin;
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(`${base}/popup.html`);
        await expect(page.locator('#searchTrigger')).toHaveText('Start');
        await expect
            .poll(
                () => page.evaluate(
                    async () => (await chrome.storage.local.get('config'))
                                    .config?.search.desk))
            .toBe(31);
        expect(await page.evaluate(() => chrome.storage.local.get([
          'machineId',
          'telemetrySent',
        ]))).toEqual({});
        expect(await page.evaluate(() => chrome.runtime.sendMessage({
          action: 'stop',
        }))).toMatchObject({success: true});

        await page.goto(`${base}/options.html`);
        await expect(page.locator('#searchDesk')).toHaveValue('31');
        await page.locator('#searchDesk').fill('77');
        await page.evaluate(async () => {
          const {config} = await chrome.storage.local.get('config');
          config.runtime.done = 1;
          await chrome.storage.local.set({config});
        });
        await expect(page.locator('#searchDesk')).toHaveValue('77');

        await page.goto(`${base}/donate.html`);
        await expect(page.locator('#sendDeviceReport')).toBeDisabled();
        await expect(page.locator('#deviceReportReceiver'))
            .toHaveText('Chưa cấu hình nơi nhận');
        expect(await page.evaluate(() => chrome.storage.local.get([
          'machineId',
          'telemetrySent',
        ]))).toEqual({});
        const secondPage = await context.newPage();
        secondPage.on('pageerror', (error) => errors.push(error.message));
        await secondPage.goto(`${base}/donate.html`);
        const edits = {url: `${base}/js/utils.js`, count: 20};
        await Promise.all([
          page.evaluate(storageSmoke.incrementConfigInBrowser, edits),
          secondPage.evaluate(storageSmoke.incrementConfigInBrowser, edits),
        ]);
        const saved = await page.evaluate(
            async () => (await chrome.storage.local.get('config')).config);
        expect(saved.storageSmokeCount).toBe(40);
        expect(saved.search.desk).toBe(31);
        // Queue a settings save first, then let the real background read the
        // old config for a stop action. Its runtime write must preserve the
        // settings committed ahead of it when the held lock is released.
        await worker.evaluate(() => {
          globalThis.storageSmokeHeld = navigator.locks.request(
              '_configWriteLock', () => new Promise((resolve) => {
                                    globalThis.storageSmokeRelease = resolve;
                                  }));
        });
        await expect
            .poll(
                () => worker.evaluate(
                    () => typeof globalThis.storageSmokeRelease))
            .toBe('function');
        try {
          await page.evaluate(async () => {
            const {atomicUpdate} =
                await import(chrome.runtime.getURL('js/utils.js'));
            globalThis.storageSmokeSave =
                atomicUpdate((config) => ({
                               ...config,
                               search: {...config.search, desk: 77},
                             }));
          });
          await expect
              .poll(
                  () => worker.evaluate(
                      async () =>
                          (await navigator.locks.query()).pending.length))
              .toBe(1);
          await secondPage.evaluate(() => {
            globalThis.storageSmokeStop =
                chrome.runtime.sendMessage({action: 'stop'});
          });
          await expect
              .poll(
                  () => worker.evaluate(
                      async () =>
                          (await navigator.locks.query()).pending.length))
              .toBe(2);
        } finally {
          await worker.evaluate(async () => {
            globalThis.storageSmokeRelease();
            await globalThis.storageSmokeHeld;
          });
        }
        await page.evaluate(() => globalThis.storageSmokeSave);
        expect(await secondPage.evaluate(() => globalThis.storageSmokeStop))
            .toMatchObject({success: true});
        expect(await page.evaluate(
                   async () => (await chrome.storage.local.get('config'))
                                   .config.search.desk))
            .toBe(77);
        await secondPage.close();
        await page.evaluate(() => chrome.storage.local.set({
          config: {
            search: 'invalid',
            schedule: null,
            device: [],
            control: {act: 'false', log: '0', niche: {}},
            runtime: {running: '0', done: '9'},
          },
        }));
        await page.goto(`${base}/options.html`);
        await expect(page.locator('#searchDesk')).toHaveValue('31');
        await expect(page.locator('#act')).not.toBeChecked();
        await expect(page.locator('#searchDesk')).toBeEnabled();
        expect(errors).toEqual([]);
        const logs = await page.evaluate(
            async () =>
                (await chrome.storage.local.get('_crashLog'))._crashLog || []);
        expect(logs.filter((entry) => entry.level !== 'event')).toEqual([]);
      } finally {
        await context?.close();
        // The absolute mkdtemp path was validated before launching the browser.
        fs.rmSync(temporary, {recursive: true, force: true});
      }
    });

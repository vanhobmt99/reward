// Real Firefox smoke test, using Mozilla's built-in Marionette protocol.
// https://firefox-source-docs.mozilla.org/remote/marionette/Protocol.html
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const http = require('node:http');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {buildFirefox} = require('./build-firefox.cjs');
const {incrementConfigInBrowser} = require('./storage-smoke.cjs');
/**
 * Waits for a short polling interval.
 * @param {number} ms Delay in milliseconds.
 * @return {!Promise<undefined>} Resolves when the timer fires.
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits until Firefox accepts a Marionette connection.
 * @param {number} port Marionette port.
 * @param {!Object} process Firefox child, including spawn and exit state.
 * @return {!Promise<!Object>} Connected socket.
 */
async function connect(port, process) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (process.spawnError) {
      throw process.spawnError;
    }
    if (process.exitCode !== null) {
      throw new Error('Firefox exited before Marionette started.');
    }
    try {
      return await new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1');
        socket.once('connect', () => resolve(socket));
        socket.once('error', reject);
      });
    } catch {
      await delay(250);
    }
  }
  throw new Error('Firefox Marionette did not start in 30 seconds.');
}
/**
 * Speaks the Marionette command protocol on one socket.
 * @param {!Object} socket Connected Marionette TCP socket.
 * @return {function(string, !Object=): !Promise<!Object>} Command sender.
 */
function client(socket) {
  let buffer = Buffer.alloc(0);
  let nextId = 0;
  const pending = new Map();
  socket.on('data', (data) => {
    buffer = Buffer.concat([buffer, data]);
    for (;;) {
      const colon = buffer.indexOf(58);
      if (colon < 0) {
        break;
      }
      const length = Number(buffer.subarray(0, colon).toString());
      if (buffer.length < colon + 1 + length) {
        break;
      }
      const message = JSON.parse(
          buffer.subarray(colon + 1, colon + 1 + length).toString(),
      );
      buffer = buffer.subarray(colon + 1 + length);
      if (!Array.isArray(message)) {
        continue;
      }  // Initial protocol handshake.
      const task = pending.get(message[1]);
      if (!task) {
        continue;
      }
      pending.delete(message[1]);
      clearTimeout(task.timer);
      if (message[2]) {
        task.reject(new Error(JSON.stringify(message[2])));
      } else {
        task.resolve(message[3]);
      }
    }
  });
  return (name, params = {}) => new Promise((resolve, reject) => {
           const id = ++nextId;
           const timer = setTimeout(() => {
             pending.delete(id);
             reject(new Error(`Marionette timed out: ${name}`));
           }, 30000);
           pending.set(id, {resolve, reject, timer});
           const data = JSON.stringify([0, id, name, params]);
           socket.write(`${Buffer.byteLength(data)}:${data}`);
         });
}
/**
 * Exercises the actual Firefox extension against the local fixture. This
 * function is serialized into Marionette and only uses page-context globals.
 * @param {string} fixtureUrl Local test server URL.
 * @param {function(string): void} done Marionette completion callback.
 * @return {!Promise<void>} Scenario completion.
 */
async function runFirefoxSmoke(fixtureUrl, done) {
  let stage = 'popup';
  try {
    const page = window.wrappedJSObject || window;
    for (let i = 0; i < 100 && !page.extension; i++) {
      await new Promise(r => setTimeout(r, 50));
    }
    const api = page.extension;
    if (!api) {
      throw new Error('Firefox popup facade did not load');
    }
    const bg = await page.browser.runtime.getBackgroundPage();
    const background = bg.wrappedJSObject || bg;
    for (let i = 0; i < 100; i++) {
      const saved = await api.storage.local.get('config');
      if (saved.config) {
        break;
      }
      await new Promise(r => setTimeout(r, 50));
    }
    const saved = await api.storage.local.get('config');
    if (!saved.config) {
      throw new Error(
          background.smokeStartupError ||
          'Firefox service did not initialize config');
    }
    for (let i = 0; i < 100 && !document.querySelector('#searchTrigger'); i++) {
      await new Promise(r => setTimeout(r, 50));
    }
    if (!document.querySelector('#searchTrigger')) {
      throw new Error('Quick-start popup did not render');
    }
    if (!document.querySelector('#openSettings')) {
      throw new Error('Settings navigation is missing');
    }
    stage = 'concurrent config writes';
    const edits = {url: api.runtime.getURL('js/utils.js'), count: 20};
    await Promise.all([
      page.smokeIncrementConfig(edits),
      background.smokeIncrementConfig(edits),
    ]);
    const afterEdits = (await api.storage.local.get('config')).config;
    if (afterEdits.storageSmokeCount !== 40 || afterEdits.search.desk !== 31) {
      throw new Error('Cross-context config edits were lost');
    }
    stage = 'create fixture';
    const tab = await api.tabs.create({url: 'about:blank', active: false});
    await reloadFixture();
    stage = 'attach fixture';
    const driver = background.extension.debugger;
    await driver.attach({tabId: tab.id});
    /**
     * Sends one command to the attached fixture tab.
     * @param {string} method Debugger method name.
     * @param {!Object} params Method parameters.
     * @return {!Promise<!Object>} Command result.
     */
    const send = (method, params) =>
        driver.sendCommand({tabId: tab.id}, method, params);
    await send(
        'Runtime.evaluate',
        {expression: 'document.querySelector("input").focus();'});
    await send('Input.insertText', {text: 'firefox smoke'});
    await send(
        'Input.dispatchKeyEvent',
        {type: 'rawKeyDown', key: 'Enter', code: 'Enter'});
    const point =
        (await send('Runtime.evaluate', {
          expression:
              '(() => { const r = document.querySelector("#reward").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()',
        })).result.value;
    await send('Input.dispatchMouseEvent', {type: 'mousePressed', ...point});
    await send('Input.dispatchMouseEvent', {type: 'mouseReleased', ...point});
    const result =
        (await send('Runtime.evaluate', {
          expression:
              '({ submitted: document.body.dataset.submitted, clicks: document.querySelector("#clicks").textContent })',
        })).result.value;
    /**
     * Reloads the fixture and waits for that top-level navigation.
     * @param {string=} baseUrl Page to open. Defaults to the fixture.
     */
    async function reloadFixture(baseUrl = fixtureUrl) {
      const url = baseUrl + '?step=' + Math.random();
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          api.webNavigation.onCompleted.removeListener(complete);
          reject(new Error('Fixture navigation timed out'));
        }, 5000);
        /**
         * Resolves when the fixture tab finishes the expected navigation.
         * @param {!{tabId: number, frameId: number, url: string}} details
         *     Navigation event.
         */
        function complete(details) {
          if (details.tabId !== tab.id || details.frameId !== 0 ||
              details.url !== url) {
            return;
          }
          clearTimeout(timer);
          api.webNavigation.onCompleted.removeListener(complete);
          resolve();
        }
        api.webNavigation.onCompleted.addListener(complete);
        api.tabs.update(tab.id, {url}).catch(error => {
          clearTimeout(timer);
          api.webNavigation.onCompleted.removeListener(complete);
          reject(error);
        });
      });
    }
    stage = 'mobile header';
    await send(
        'Network.setUserAgentOverride', {userAgent: 'Firefox-Mobile-Smoke'});
    await reloadFixture();
    result.mobileHeader =
        (await send('Runtime.evaluate', {
          expression: 'document.querySelector("#http-user-agent").textContent',
        })).result.value;
    stage = 'cleanup';
    await api.cookies.set(
        {url: fixtureUrl, name: 'rsa-cleanup', value: 'test'});
    await send(
        'Runtime.evaluate',
        {expression: 'localStorage.setItem("rsa-cleanup", "test");'});
    await api.cookies.set(
        {url: 'https://www.bing.com/', name: 'rsa-preserved', value: 'test'});
    // Match service.clear(): leave the origin before clearing its live
    // storage so the old document cannot retain/recreate local data.
    await reloadFixture(api.runtime.getURL('loading.html'));
    await background.extension.browsingData.remove(
        {origins: [fixtureUrl], since: 0}, {
          cookies: true,
          localStorage: true,
          serviceWorkers: true,
          cacheStorage: true,
          cache: true,
          pluginData: true,
        });
    result.localCookieCleared =
        !(await api.cookies.get({url: fixtureUrl, name: 'rsa-cleanup'}));
    result.otherHostCookiePreserved = !!(await api.cookies.get(
        {url: 'https://www.bing.com/', name: 'rsa-preserved'}));
    await driver.detach({tabId: tab.id});
    stage = 'desktop restore';
    await reloadFixture();
    result.desktopHeader = (await api.tabs.executeScript(
        tab.id,
        {code: 'document.querySelector("#http-user-agent").textContent'}))[0];
    result.localStorageCleared = (await api.tabs.executeScript(
        tab.id, {code: 'localStorage.getItem("rsa-cleanup") === null'}))[0];
    await api.tabs.remove(tab.id);
    stage = 'stop message';
    result.stopResponse = await api.runtime.sendMessage({action: 'stop'});
    const alarms = await api.alarms.getAll();
    const logs = await api.storage.local.get('_crashLog');
    done(JSON.stringify({
      ...result,
      config: !!saved.config,
      concurrentConfigEdits: afterEdits.storageSmokeCount,
      alarms: alarms.map(a => a.name),
      errors: (logs._crashLog || []).filter(entry => entry.level !== 'event'),
      popupTitle: document.title,
      popupStart: document.querySelector('#searchTrigger').textContent,
      popupDesktopCount: document.querySelector('#desktopCount').textContent,
      optionsPage: api.runtime.getURL('options.html'),
    }));

  } catch (error) {
    done(JSON.stringify({error: error.message, stack: error.stack, stage}));
  }
}

async function main() {
  const binary = process.env.FIREFOX_BINARY ||
      'C:\\Program Files\\Mozilla Firefox\\firefox.exe';
  if (!fs.existsSync(binary)) {
    throw new Error('Set FIREFOX_BINARY to your Firefox executable.');
  }
  const temp = fs.mkdtempSync(
      path.join(os.tmpdir(), 'search-auto-firefox-smoke-'),
  );
  let server;
  let firefox;
  let socket;
  let send;
  let output = '';
  try {
    const extensionDir = buildFirefox(path.join(temp, 'extension'));
    for (const entry of ['firefox-popup.js', 'firefox-background.js']) {
      fs.appendFileSync(
          path.join(extensionDir, 'js', entry),
          `\nglobalThis.smokeIncrementConfig = ${
              incrementConfigInBrowser.toString()};\n`);
    }
    fs.appendFileSync(
        path.join(extensionDir, 'js', 'firefox-background.js'),
        '\nimport("./service.js").catch(error => { globalThis.smokeStartupError = error.message + "\\n" + error.stack; });\n',
    );
    // Only the test build gets localhost permission. The shipped manifest stays
    // restricted to the production hosts.
    const manifestPath = path.join(extensionDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.permissions.push('http://127.0.0.1/*');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const adapterPath = path.join(extensionDir, 'js', 'firefox-api.js');
    fs.writeFileSync(
        adapterPath,
        fs.readFileSync(adapterPath, 'utf8')
            .replace(
                /urls:\s*\[(['"])\*:\/\/\*\.bing\.com\/\*\1\]/,
                'urls: ["*://*.bing.com/*", "http://127.0.0.1/*"]',
                ),
    );
    server = http.createServer((_req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      const userAgent = (_req.headers['user-agent'] || '')
                            .replaceAll('&', '&amp;')
                            .replaceAll('<', '&lt;');
      res.end(
          '<!doctype html><form><input id="sb_form_q"><button type="submit">Search</button></form><button id="reward">Claim</button><output id="clicks">0</output><pre id="http-user-agent">' +
              userAgent +
              '</pre><script>document.querySelector("#reward").onclick = () => document.querySelector("#clicks").textContent++; document.querySelector("form").onsubmit = e => { e.preventDefault(); document.body.dataset.submitted = document.querySelector("input").value; };</script>',
      );
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const fixtureUrl = `http://127.0.0.1:${server.address().port}/`;
    const portServer = net.createServer();
    await new Promise((resolve) => portServer.listen(0, '127.0.0.1', resolve));
    const port = portServer.address().port;
    await new Promise((resolve) => portServer.close(resolve));
    const profile = path.join(temp, 'profile');
    fs.mkdirSync(profile);
    fs.writeFileSync(
        path.join(profile, 'user.js'),
        `user_pref("marionette.port", ${
            port});\nuser_pref("browser.shell.checkDefaultBrowser", false);\nuser_pref("browser.startup.page", 0);\nuser_pref("datareporting.policy.dataSubmissionEnabled", false);\n`,
    );
    firefox = spawn(
        binary,
        [
          '-headless',
          '-no-remote',
          '-profile',
          profile,
          '--marionette',
          '--remote-allow-system-access',
        ],
        {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']},
    );
    firefox.once('error', (error) => {
      firefox.spawnError = error;
    });
    firefox.stdout.on('data', (data) => {
      output += data.toString();
    });
    firefox.stderr.on('data', (data) => {
      output += data.toString();
    });
    socket = await connect(port, firefox);
    send = client(socket);
    const session = await send('WebDriver:NewSession', {});
    console.log(`Firefox ${session.capabilities.browserVersion}`);
    const packagePath = path.resolve(
        __dirname,
        '..',
        'dist',
        `search-auto-firefox-${manifest.version}.zip`,
    );
    if (fs.existsSync(packagePath)) {
      const installed = await send('Addon:Install', {
        path: packagePath,
        temporary: true,
      });
      assert.equal(installed.value, 'search-auto@vanhobmt99');
      await send('Addon:Uninstall', {id: installed.value});
      console.log('Packaged Firefox ZIP installed successfully.');
    }
    await send('Addon:Install', {path: extensionDir, temporary: true});
    await send('Marionette:SetContext', {value: 'chrome'});
    const uuid =
        (await send('WebDriver:ExecuteScript', {
          script:
              'return WebExtensionPolicy.getByID("search-auto@vanhobmt99").mozExtensionHostname;',
          args: [],
          newSandbox: true,
        })).value;
    await send('Marionette:SetContext', {value: 'content'});
    await send('WebDriver:Navigate', {
      url: `moz-extension://${uuid}/popup.html`,
    });
    const report =
        (await send('WebDriver:ExecuteAsyncScript', {
          args: [fixtureUrl],
          newSandbox: true,
          scriptTimeout: 25000,
          script: `(${
              runFirefoxSmoke
                  .toString()})(arguments[0], arguments[arguments.length - 1]);`,
        })).value;
    const result = JSON.parse(report);
    console.log(JSON.stringify(result, null, 2));
    assert.equal(result.error, undefined);
    assert.equal(result.config, true);
    assert.equal(result.submitted, 'firefox smoke');
    assert.equal(result.clicks, '1');
    assert.equal(result.mobileHeader, 'Firefox-Mobile-Smoke');
    assert.match(result.desktopHeader, /Firefox\//);
    assert.equal(result.localCookieCleared, true);
    assert.equal(result.otherHostCookiePreserved, true);
    assert.equal(result.localStorageCleared, true);
    assert.equal(result.stopResponse.success, true);
    assert.equal(result.popupStart, 'Start');
    assert.equal(result.popupDesktopCount, '31');
    assert.match(result.optionsPage, /options\.html$/);
    assert.ok(result.alarms.includes('clear'));
    assert.equal(result.errors.length, 0);
    console.log('Firefox runtime smoke test passed.');
  } catch (error) {
    if (send) {
      try {
        await send('Marionette:SetContext', {value: 'chrome'});
        const diagnostics = await send('WebDriver:ExecuteScript', {
          script:
              'return Services.console.getMessageArray().map(entry => entry.message).filter(message => message.includes("moz-extension://")).slice(-15);',
          args: [],
          newSandbox: true,
        });
        console.error(JSON.stringify(diagnostics.value, null, 2));
      } catch (diagnosticError) {
        console.error(
            `Firefox diagnostics unavailable: ${diagnosticError.message}`);
      }
    }
    console.error(output.slice(-4000));
    throw error;
  } finally {
    if (send) {
      await send('Marionette:Quit', {flags: ['eForceQuit']}).catch(() => {});
    }
    if (socket) {
      socket.destroy();
    }
    if (firefox && !firefox.spawnError && isRunning(firefox)) {
      await waitForExit(firefox);
      if (isRunning(firefox)) {
        firefox.kill();
        await waitForExit(firefox);
      }
    }
    if (server?.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (firefox && !firefox.spawnError && isRunning(firefox)) {
      console.error(`Firefox did not exit; test profile retained: ${temp}`);
      process.exitCode = 1;
    } else if (process.env.KEEP_FIREFOX_TEST_PROFILE === '1') {
      console.log(`Firefox test profile retained: ${temp}`);
    } else {
      // temp was created by this run, directly under the OS temporary
      // directory. Check the absolute target before recursively removing it on
      // Windows.
      assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
      assert.match(path.basename(temp), /^search-auto-firefox-smoke-/);
      fs.rmSync(temp, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 200,
      });
      console.log('Firefox temporary test files removed.');
    }
  }
}

/**
 * Reports whether a child process is still alive.
 * @param {!Object} child Spawned process.
 * @return {boolean} True until the process exits or is signaled.
 */
function isRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}

/**
 * Waits until a child exits, or gives up after five seconds.
 * @param {!Object} child Spawned process.
 * @return {!Promise<undefined>} Resolves on exit or timeout.
 */
function waitForExit(child) {
  if (!isRunning(child)) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      child.removeListener('exit', finish);
      resolve();
    };
    const timer = setTimeout(finish, 5000);
    child.once('exit', finish);
  });
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});


const {toContainSource} = require('./source-assertions');
expect.extend({toContainSource});
const fs = require('fs');
const path = require('path');
const {loadEsmModule} = require('./esm-loader.js');

const {ACTIONS, CONTENT_ACTIONS, MESSAGE_TIMEOUT_MS} =
    loadEsmModule('../js/messages.js');
const contentSource = fs.readFileSync(
    path.join(__dirname, '../js/content.js'),
    'utf8',
);
const popupSource = fs.readFileSync(
    path.join(__dirname, '../js/popup.js'),
    'utf8',
);

describe('messages module', () => {
  test('exposes the popup→worker command names', () => {
    expect(ACTIONS).toMatchObject({
      START: 'start',
      SCHEDULE: 'schedule',
      STOP: 'stop',
      ACTIVITY: 'activity',
      CLEAR_BROWSING_DATA: 'clearBrowsingData',
      SIMULATE: 'simulate',
    });
  });

  test('defines a positive round-trip timeout', () => {
    expect(MESSAGE_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe('content script mirrors CONTENT_ACTIONS', () => {
  // content.js cannot import ESM, so it uses string literals that must equal
  // the canonical CONTENT_ACTIONS values. This guards against silent drift.
  test.each(Object.entries(CONTENT_ACTIONS))(
      'handles the %s action (%s)',
      (_name, value) => {
        expect(contentSource).toContainSource(`case "${value}":`);
      },
  );
});

describe('popup uses the shared ACTIONS enum, not raw command strings', () => {
  test('does not send raw action string literals to the worker', () => {
    // Guards against reintroducing action: "start" etc. in sendMessage calls.
    for (const value of Object.values(ACTIONS)) {
      expect(popupSource).not.toContainSource(`action: "${value}"`);
    }
  });

  test('routes worker commands through sendMessageWithTimeout', () => {
    for (const name of ['popup', 'options']) {
      const source =
          fs.readFileSync(path.join(__dirname, `../js/${name}.js`), 'utf8');
      expect(source).toContainSource(
          'import {ACTIONS, sendMessageWithTimeout} from \'/js/messages.js\'');
      expect(source).not.toContainSource('function sendMessageWithTimeout(');
      expect(source).not.toContainSource('chrome.runtime.sendMessage(');
    }
    expect(popupSource)
        .not.toContainSource('chrome.runtime.sendMessage({ action:');
  });
});

describe('bounded runtime messages', () => {
  let send;
  let sendMessageWithTimeout;

  beforeEach(() => {
    jest.useFakeTimers();
    send = jest.fn();
    ({sendMessageWithTimeout} = loadEsmModule('../js/messages.js', {
       chrome: {runtime: {sendMessage: send}},
       setTimeout,
       clearTimeout,
     }));
  });
  afterEach(() => jest.useRealTimers());

  test('successful response cancels the timeout', async () => {
    send.mockResolvedValue({success: true});
    await expect(sendMessageWithTimeout({action: 'stop'}, 100))
        .resolves.toEqual({success: true});
    expect(send).toHaveBeenCalledWith({action: 'stop'});
    expect(jest.getTimerCount()).toBe(0);
  });

  test.each(['sync', 'async'])(
      '%s API failure cancels the timeout', async (mode) => {
        const error = new Error('Disconnected');
        send.mockImplementation(() => {
          if (mode === 'sync') {
            throw error;
          }
          return Promise.reject(error);
        });
        await expect(sendMessageWithTimeout({}, 100)).rejects.toBe(error);
        expect(jest.getTimerCount()).toBe(0);
      });

  test.each([
    'resolve',
    'reject',
  ])('late %s cannot settle a timed-out request again', async (mode) => {
    let finish;
    send.mockImplementation(() => new Promise((resolve, reject) => {
                              finish = mode === 'resolve' ? resolve : reject;
                            }));
    const result = sendMessageWithTimeout({}, 100);
    const rejection = expect(result).rejects.toThrow('100 ms');
    await jest.advanceTimersByTimeAsync(100);
    await rejection;
    finish(mode === 'resolve' ? {success: true} : new Error('Late failure'));
    await Promise.resolve();
    await expect(result).rejects.toThrow('100 ms');
    expect(jest.getTimerCount()).toBe(0);
  });
});

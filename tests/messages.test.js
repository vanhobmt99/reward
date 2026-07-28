const fs = require("fs");
const path = require("path");
const { loadEsmModule } = require("./esm-loader.js");

const { ACTIONS, CONTENT_ACTIONS, MESSAGE_TIMEOUT_MS } =
  loadEsmModule("../js/messages.js");
const contentSource = fs.readFileSync(
  path.join(__dirname, "../js/content.js"),
  "utf8",
);
const popupSource = fs.readFileSync(
  path.join(__dirname, "../js/popup.js"),
  "utf8",
);

describe("messages module", () => {
  test("exposes the popup→worker command names", () => {
    expect(ACTIONS).toMatchObject({
      START: "start",
      SCHEDULE: "schedule",
      STOP: "stop",
      ACTIVITY: "activity",
      CLEAR_BROWSING_DATA: "clearBrowsingData",
      SIMULATE: "simulate",
    });
  });

  test("defines a positive round-trip timeout", () => {
    expect(MESSAGE_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe("content script mirrors CONTENT_ACTIONS", () => {
  // content.js cannot import ESM, so it uses string literals that must equal the
  // canonical CONTENT_ACTIONS values. This guards against silent drift.
  test.each(Object.entries(CONTENT_ACTIONS))(
    "handles the %s action (%s)",
    (_name, value) => {
      expect(contentSource).toContain(`case "${value}":`);
    },
  );
});

describe("popup uses the shared ACTIONS enum, not raw command strings", () => {
  test("does not send raw action string literals to the worker", () => {
    // Guards against reintroducing action: "start" etc. in sendMessage calls.
    for (const value of Object.values(ACTIONS)) {
      expect(popupSource).not.toContain(`action: "${value}"`);
    }
  });

  test("routes worker commands through sendMessageWithTimeout", () => {
    expect(popupSource).toContain("function sendMessageWithTimeout(");
    expect(popupSource).not.toContain("chrome.runtime.sendMessage({ action:");
  });
});

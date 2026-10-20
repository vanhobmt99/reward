import { createFirefoxApi } from "./firefox-api.js";
globalThis.extension = createFirefoxApi(browser, { automationEnabled: false });
import("./popup.js").catch(console.error);

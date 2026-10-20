import { createFirefoxApi } from "./firefox-api.js";
globalThis.extension = createFirefoxApi(browser);
import("./service.js").catch(console.error);

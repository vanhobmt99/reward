const { loadEsmModule } = require("./esm-loader.js");

const { DONATE_PAGE, shouldShowDonateOnInstall } =
  loadEsmModule("../js/welcome.js");

describe("first-install donate page", () => {
  test("opens only when the extension is installed, not when it updates", () => {
    expect(shouldShowDonateOnInstall("install")).toBe(true);
    expect(shouldShowDonateOnInstall("update")).toBe(false);
    expect(shouldShowDonateOnInstall("chrome_update")).toBe(false);
    expect(shouldShowDonateOnInstall(undefined)).toBe(false);
    expect(DONATE_PAGE).toBe("/donate.html");
  });
});

const { loadEsmModule } = require("./esm-loader.js");

const { devices } = loadEsmModule("../js/devices.js");

describe("devices catalogue", () => {
  test("is a non-empty array", () => {
    expect(Array.isArray(devices)).toBe(true);
    expect(devices.length).toBeGreaterThan(0);
  });

  test("every device has the fields the simulator reads", () => {
    for (const d of devices) {
      expect(typeof d.name).toBe("string");
      expect(d.name.trim().length).toBeGreaterThan(0);
      expect(typeof d.userAgent).toBe("string");
      expect(d.userAgent).toMatch(/Mozilla\/5\.0/);
      expect(Number.isFinite(d.width)).toBe(true);
      expect(Number.isFinite(d.height)).toBe(true);
      expect(Number.isFinite(d.deviceScaleFactor)).toBe(true);
    }
  });

  test("dimensions and scale are positive and mobile-sized", () => {
    for (const d of devices) {
      expect(d.width).toBeGreaterThan(0);
      expect(d.height).toBeGreaterThan(0);
      expect(d.deviceScaleFactor).toBeGreaterThan(0);
      // Guard against a desktop-sized profile sneaking in (would break emulation).
      expect(d.width).toBeLessThanOrEqual(1024);
    }
  });

  test("device names are unique", () => {
    const names = devices.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("userAgent looks like a mobile UA", () => {
    for (const d of devices) {
      expect(/Mobile|Android|iPhone|iPad/i.test(d.userAgent)).toBe(true);
    }
  });
});

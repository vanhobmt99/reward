import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("unpacked extension pack", () => {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

  it("manifest names the service worker and popup that exist on disk", () => {
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.name, "Search Auto");
    const sw = join(root, manifest.background.service_worker.replace(/^\//, ""));
    const popup = join(root, manifest.action.default_popup.replace(/^\//, ""));
    assert.equal(existsSync(sw), true);
    assert.equal(existsSync(popup), true);
  });

  it("every declared icon, content script, and host file exists", () => {
    for (const icon of Object.values(manifest.icons || {})) {
      assert.equal(existsSync(join(root, icon.replace(/^\//, ""))), true, icon);
    }
    for (const script of manifest.content_scripts?.[0]?.js || []) {
      assert.equal(existsSync(join(root, script.replace(/^\//, ""))), true, script);
    }
  });

  it("popup.html still exposes the main run controls", () => {
    const html = readFileSync(join(root, "popup.html"), "utf8");
    assert.match(html, /id="searchDesk"/);
    assert.match(html, /id="searchMob"/);
    assert.match(html, /id="searchTrigger"/);
  });

  it("includes login.windows.net among Rewards login hosts", () => {
    assert.equal(manifest.host_permissions.includes("*://login.windows.net/*"), true);
  });

  it("blocks CFP, Clarity, and OneCollector via static DNR rules", () => {
    assert.equal(manifest.permissions.includes("declarativeNetRequest"), true);
    const resources = manifest.declarative_net_request?.rule_resources || [];
    const telemetry = resources.find((r) => r.id === "block_telemetry");
    assert.ok(telemetry?.enabled);
    const rulesPath = join(root, telemetry.path);
    assert.equal(existsSync(rulesPath), true, telemetry.path);
    const rules = JSON.parse(readFileSync(rulesPath, "utf8"));
    const domains = new Set(
      rules.flatMap((rule) => rule.condition?.requestDomains || []),
    );
    for (const host of [
      "df.cfp.microsoft.com",
      "clarity.ms",
      "browser.events.data.microsoft.com",
      "browser.events.data.msn.com",
    ]) {
      assert.equal(domains.has(host), true, host);
    }
    assert.equal(
      rules.every((rule) => rule.action?.type === "block"),
      true,
    );
  });
});

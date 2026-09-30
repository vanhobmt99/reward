const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { parse } = require("acorn");

// Rewrite API identifiers only; search queries and injected source strings stay
// byte-for-byte intact. https://github.com/acornjs/acorn/blob/master/acorn/README.md
function rewriteChromeApi(source) {
  const ast = parse(source, { ecmaVersion: 2022, sourceType: "module" });
  const offsets = [];
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (
      node.type === "MemberExpression" &&
      node.object?.type === "Identifier" &&
      node.object.name === "chrome"
    ) {
      offsets.push(node.object.start);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  }
  visit(ast);
  for (const offset of offsets.sort((a, b) => b - a)) {
    source =
      source.slice(0, offset) +
      "extension" +
      source.slice(offset + "chrome".length);
  }
  return source;
}

const root = path.resolve(__dirname, "..");
function buildFirefox(output = path.join(root, "dist", "firefox")) {
  output = path.resolve(output);
  // Only disposable build directories may be replaced. Resolve the existing
  // parent too, so a symlink cannot redirect cleanup outside these roots.
  const defaultOutput = path.join(root, "dist", "firefox");
  const tempRelative = path.relative(os.tmpdir(), output);
  const inTestTemp =
    !path.isAbsolute(tempRelative) &&
    /^search-auto-firefox-(?:build|smoke)-[^\\/]+(?:[\\/]extension)?$/.test(
      tempRelative,
    );
  if (output !== defaultOutput && !inTestTemp) {
    throw new Error(
      "Firefox output must be dist/firefox or a Firefox test directory.",
    );
  }
  let existing = output;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const allowedRoot = inTestTemp ? os.tmpdir() : root;
  const relative = path.relative(
    fs.realpathSync(allowedRoot),
    fs.realpathSync(existing),
  );
  const expected = path.join(
    fs.realpathSync(allowedRoot),
    path.relative(allowedRoot, existing),
  );
  if (
    path.isAbsolute(relative) ||
    relative.split(path.sep).includes("..") ||
    path.relative(expected, fs.realpathSync(existing)) !== ""
  ) {
    throw new Error("Firefox output resolves outside its build root.");
  }
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const chromeManifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
  );
  const {
    action,
    host_permissions,
    minimum_chrome_version,
    offline_enabled,
    ...manifest
  } = chromeManifest;
  manifest.manifest_version = 2;
  manifest.browser_action = action;
  manifest.background = { page: "firefox-background.html", persistent: true };
  manifest.permissions = [
    ...manifest.permissions.filter((permission) => permission !== "debugger"),
    "webRequest",
    "webRequestBlocking",
    ...host_permissions,
  ];
  manifest.content_security_policy = "script-src 'self'; object-src 'self';";
  manifest.browser_specific_settings = {
    gecko: { id: "search-auto@vanhobmt99", strict_min_version: "128.0" },
  };
  fs.writeFileSync(
    path.join(output, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(output, "firefox-background.html"),
    '<!doctype html>\n<meta charset="utf-8">\n<script type="module" src="/js/firefox-background.js"></script>\n',
  );
  for (const dir of ["js", "css", "fonts", "logo"]) {
    fs.cpSync(path.join(root, dir), path.join(output, dir), {
      recursive: true,
      filter: (source) =>
        fs.statSync(source).isDirectory() ||
        (!/\.(?:log|tmp|bak|swp|zip)$/i.test(source) &&
          path.basename(source) !== "fingerprint.js"),
    });
  }
  // The donation page needs only these images, not development documentation.
  fs.mkdirSync(path.join(output, "docs"));
  for (const file of ["momo.jpg", "vietcombank.png"]) {
    fs.copyFileSync(
      path.join(root, "docs", file),
      path.join(output, "docs", file),
    );
  }
  for (const name of fs.readdirSync(path.join(output, "js"))) {
    if (
      !name.endsWith(".js") ||
      name === "content.js" ||
      name.startsWith("firefox-")
    )
      continue;
    const target = path.join(output, "js", name);
    fs.writeFileSync(target, rewriteChromeApi(fs.readFileSync(target, "utf8")));
  }
  for (const file of [
    "popup.html",
    "manual.html",
    "donate.html",
    "loading.html",
  ]) {
    let html = fs.readFileSync(path.join(root, file), "utf8");
    if (file === "popup.html") {
      html = html.replace("/js/popup.js", "/js/firefox-popup.js");
      html = html.replace(
        "</body>",
        '<p style="padding: 0 16px 12px; font-size: 12px">Firefox: Mobile chỉ đổi User-Agent HTTP; một số nhiệm vụ cần bấm thủ công. Xem Hướng dẫn sử dụng.</p>\n</body>',
      );
    }
    if (file === "manual.html") {
      html = fs.readFileSync(path.join(root, "firefox", "manual.html"), "utf8");
    }
    html = html
      .replace(/Google Chrome|Chrome/g, "Firefox")
      .replace(
        /chrome:\/\/extensions → Service worker/g,
        "about:debugging → This Firefox → Inspect",
      );
    fs.writeFileSync(path.join(output, file), html);
  }
  console.log(`Firefox extension built: ${output}`);
  return output;
}
if (require.main === module) buildFirefox();
module.exports = { buildFirefox, rewriteChromeApi };

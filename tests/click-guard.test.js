import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("coordinate clicks reject hidden and covered targets", () => {
  const service = readFileSync(join(root, "js", "service.js"), "utf8");
  const injected = readFileSync(
    join(root, "js", "injected-scripts.js"),
    "utf8",
  );

  assert.doesNotMatch(service, /\n\s*"#id_s",/);
  assert.match(service, /right - left < 8 \|\| bottom - top < 8/);
  assert.match(service, /document\.elementFromPoint/);
  assert.match(service, /Click target moved or became covered/);
  assert.match(injected, /if \(!hit\) \{\s*pressPoint = null;\s*return false;/);
  assert.match(injected, /if \(!hit\) return null;/);
});

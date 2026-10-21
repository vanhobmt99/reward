const fs = require('node:fs');
const path = require('node:path');
const {HTML_FILES, prepareOutput, copyRuntimeFiles, validateExtension} =
    require('./build-files.cjs');
const {parse} = require('acorn');

// https://github.com/acornjs/acorn/blob/master/acorn/README.md
/**
 * Rewrites chrome API identifiers to the Firefox extension facade.
 * Search queries and injected source strings stay byte-for-byte intact.
 * @param {string} source Module source.
 * @return {string} Source with chrome member roots renamed.
 */
function rewriteChromeApi(source) {
  const ast = parse(source, {ecmaVersion: 2022, sourceType: 'module'});
  const offsets = [];
  /**
   * Records offsets of chrome member roots. Non-nodes are ignored.
   * @param {?Object} node Acorn node, or a non-node child.
   */
  function visit(node) {
    if (!node || typeof node !== 'object') {
      return;
    }
    if (node.type === 'MemberExpression' &&
        node.object?.type === 'Identifier' && node.object.name === 'chrome') {
      offsets.push(node.object.start);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        value.forEach(visit);
      } else if (value && typeof value === 'object') {
        visit(value);
      }
    }
  }
  visit(ast);
  for (const offset of offsets.sort((a, b) => b - a)) {
    source = source.slice(0, offset) + 'extension' +
        source.slice(offset + 'chrome'.length);
  }
  return source;
}

const root = path.resolve(__dirname, '..');
/**
 * Assembles the Firefox package from the shared runtime.
 * @param {string=} output Requested output directory.
 * @return {string} Validated absolute output directory.
 */
function buildFirefox(output = path.join(root, 'dist', 'firefox')) {
  output = prepareOutput('firefox', output);
  const chromeManifest = JSON.parse(
      fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'),
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
  manifest.background = {page: 'firefox-background.html', persistent: true};
  manifest.permissions = [
    ...manifest.permissions.filter(
        (permission) =>
            permission !== 'debugger' && !permission.startsWith('system.'),
        ),
    'webRequest',
    'webRequestBlocking',
    ...host_permissions,
  ];
  manifest.content_security_policy =
      'script-src \'self\'; object-src \'self\';';
  manifest.browser_specific_settings = {
    gecko: {id: 'search-auto@vanhobmt99', strict_min_version: '128.0'},
  };
  fs.writeFileSync(
      path.join(output, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
  );
  fs.writeFileSync(
      path.join(output, 'firefox-background.html'),
      '<!doctype html>\n<meta charset="utf-8">\n<script type="module" src="/js/firefox-background.js"></script>\n',
  );
  copyRuntimeFiles(output, 'firefox');
  for (const name of fs.readdirSync(path.join(output, 'js'))) {
    if (!name.endsWith('.js') || name === 'content.js' ||
        name.startsWith('firefox-')) {
      continue;
    }
    const target = path.join(output, 'js', name);
    fs.writeFileSync(target, rewriteChromeApi(fs.readFileSync(target, 'utf8')));
  }
  for (const file of HTML_FILES) {
    let html = fs.readFileSync(path.join(root, file), 'utf8');
    if (file === 'popup.html') {
      html = html.replace('/js/popup.js', '/js/firefox-popup.js');
      html = html.replace(
          '</body>',
          '<p style="padding: 0 16px 12px; font-size: 12px">Firefox: Mobile chỉ đổi User-Agent HTTP; một số nhiệm vụ cần bấm thủ công. Xem Hướng dẫn sử dụng.</p>\n</body>',
      );
    }
    if (file === 'manual.html') {
      html = fs.readFileSync(path.join(root, 'firefox', 'manual.html'), 'utf8');
    }
    html = html.replace(/Google Chrome|Chrome/g, 'Firefox')
               .replace(
                   /chrome:\/\/extensions → Service worker/g,
                   'about:debugging → This Firefox → Inspect',
               );
    fs.writeFileSync(path.join(output, file), html);
  }
  validateExtension(output);
  console.log(`Firefox extension built: ${output}`);
  return output;
}
if (require.main === module) {
  buildFirefox();
}
module.exports = {
  buildFirefox,
  rewriteChromeApi,
};

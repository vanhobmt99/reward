const fs = require('node:fs');
const path = require('node:path');
const {ROOT, HTML_FILES, prepareOutput, copyRuntimeFiles, validateExtension} =
    require('./build-files.cjs');

/**
 * Builds the unpacked MV3 extension from the runtime allowlist.
 * @param {string=} output Disposable build destination.
 * @return {string} Absolute extension directory.
 */
function buildChrome(output = path.join(ROOT, 'dist', 'chrome')) {
  output = prepareOutput('chrome', output);
  copyRuntimeFiles(output, 'chrome');
  for (const name of ['manifest.json', ...HTML_FILES]) {
    fs.copyFileSync(path.join(ROOT, name), path.join(output, name));
  }
  validateExtension(output);
  console.log(`Chrome extension built: ${output}`);
  return output;
}

if (require.main === module) {
  buildChrome();
}
module.exports = {buildChrome};

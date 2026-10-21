const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {buildChrome} = require('../scripts/build-chrome.cjs');
const {validateExtension} = require('../scripts/build-files.cjs');

test(
    'Chrome build includes complete runtime assets and replaces stale files',
    () => {
      const output =
          fs.mkdtempSync(path.join(os.tmpdir(), 'search-auto-chrome-build-'));
      try {
        buildChrome(output);
        const manifest = JSON.parse(
            fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
        expect(manifest.manifest_version).toBe(3);
        expect(fs.existsSync(path.join(output, 'js/fingerprint.js')))
            .toBe(true);
        expect(fs.existsSync(path.join(output, 'js/firefox-api.js')))
            .toBe(false);
        for (const name
                 of ['tests', 'tasks', 'node_modules', '.cleanup-baseline',
                     'package.json']) {
          expect(fs.existsSync(path.join(output, name))).toBe(false);
        }
        fs.writeFileSync(path.join(output, 'stale.txt'), 'stale');
        buildChrome(output);
        expect(fs.existsSync(path.join(output, 'stale.txt'))).toBe(false);
        fs.unlinkSync(path.join(output, 'js/messages.js'));
        expect(() => validateExtension(output))
            .toThrow('Missing or unsafe reference');
      } finally {
        fs.rmSync(output, {recursive: true, force: true});
      }
    });

test(
    'Chrome build refuses to replace project or temporary-directory roots',
    () => {
      expect(() => buildChrome(path.join(__dirname, '..')))
          .toThrow('Chrome output must be');
      expect(() => buildChrome(os.tmpdir())).toThrow('Chrome output must be');
    });

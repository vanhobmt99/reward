/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');
const {parse} = require('acorn');
const {loadEsmModule} = require('./esm-loader');

const {createDefaultConfig, applyConfigDefaults} =
    loadEsmModule('../js/config-defaults.js');
const original =
    fs.readFileSync(path.join(__dirname, '../js/options.js'), 'utf8');
const program = parse(original, {ecmaVersion: 2022, sourceType: 'module'});
// Only strip static imports; evaluate the actual production UI implementation.
let source = original;
for (const node of program.body
         .filter(node => node.type === 'ImportDeclaration')
         .reverse()) {
  source = source.slice(0, node.start) + source.slice(node.end);
}

/**
 * Mounts the real options document and captures its storage listener.
 * @return {!Promise<!Object>} Isolated UI fixture and counters.
 */
async function mountOptions() {
  document.documentElement.innerHTML =
      fs.readFileSync(path.join(__dirname, '../options.html'), 'utf8');
  const config = createDefaultConfig();
  config.schedule.mode = 'm5';
  const alarms = {
    get: jest.fn().mockResolvedValue({scheduledTime: Date.now() + 10000}),
  };
  const changed = {addListener: jest.fn()};
  const chrome = {
    runtime: {
      /**
       * Returns the fixture extension manifest.
       * @return {!{version: string}} Manifest used by the options page.
       */
      getManifest: () => ({version: 'test'}),
    },
    alarms,
    storage: {onChanged: changed},
  };
  // Capture the async init handler so the fixture can await its actual
  // completion.
  let initialize;
  const addListener = jest.spyOn(document, 'addEventListener');
  addListener.mockImplementation((name, listener) => {
    if (name === 'DOMContentLoaded') {
      initialize = listener;
    }
  });
  try {
    new Function(
        'get', 'applyConfigDefaults', 'createDefaultConfig', 'chrome', 'CSS',
        source)(
        async () => config, applyConfigDefaults, createDefaultConfig, chrome, {
          /**
           * Leaves CSS identifiers unchanged in this fixture.
           * @param {string} value Identifier passed to CSS.escape.
           * @return {string} The same identifier.
           */
          escape: value => value,
        });
  } finally {
    addListener.mockRestore();
  }
  await initialize();
  return {config, alarms, onChange: changed.addListener.mock.calls[0][0]};
}

test(
    'progress-only storage writes preserve form edits and avoid alarm queries',
    async () => {
      const {config, alarms, onChange} = await mountOptions();
      const input = document.querySelector('#searchDesk');
      input.value = '77';
      alarms.get.mockClear();
      for (let done = 1; done <= 100; done++) {
        onChange(
            {
              config:
                  {newValue: {...config, runtime: {...config.runtime, done}}},
            },
            'local');
      }
      expect(input.value).toBe('77');
      expect(alarms.get).not.toHaveBeenCalled();
    });

test(
    'run state changes still disable the controls and refresh schedule status',
    async () => {
      const {config, alarms, onChange} = await mountOptions();
      alarms.get.mockClear();
      onChange(
          {
            config: {
              newValue: {...config, runtime: {...config.runtime, running: 1}},
            },
          },
          'local');
      expect(document.querySelector('#searchDesk').disabled).toBe(true);
      expect(document.querySelector('#activity').disabled).toBe(true);
      expect(alarms.get).toHaveBeenCalledTimes(1);
      onChange({config: {newValue: config}}, 'local');
      expect(document.querySelector('#searchDesk').disabled).toBe(false);
    });

test(
    'settings changed by another page and storage removal still update the form',
    async () => {
      const {config, onChange} = await mountOptions();
      onChange(
          {
            config:
                {newValue: {...config, search: {...config.search, desk: 42}}},
          },
          'local');
      expect(document.querySelector('#searchDesk').value).toBe('42');
      onChange({config: {}}, 'local');
      expect(document.querySelector('#searchDesk').value)
          .toBe(String(createDefaultConfig().search.desk));
    });

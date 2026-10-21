const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {parse} = require('acorn');
const {loadEsmModule} = require('./esm-loader');

const {createDefaultConfig, applyConfigDefaults} =
    loadEsmModule('../js/config-defaults.js');
const source =
    fs.readFileSync(path.join(__dirname, '../js/service.js'), 'utf8');
const bootstrap = parse(source, {ecmaVersion: 2022, sourceType: 'module'})
                      .body.find(
                          (node) => node.type === 'FunctionDeclaration' &&
                              node.id.name === 'bootstrapConfig');

/**
 * Evaluates the real bootstrapConfig declaration against stored settings.
 * @param {?Object} stored Previously saved config, or null.
 * @return {!Object} Sandbox that received the production function.
 */
function loadBootstrap(stored) {
  const context = {
    createDefaultConfig,
    applyConfigDefaults,
    atomicUpdate: jest.fn(async (update) => update(stored || {})),
    applyStoredConfig: jest.fn(),
    ensureAlarms: jest.fn(),
    logs: false,
    log: jest.fn(),
  };
  vm.createContext(context);
  vm.runInContext(source.slice(bootstrap.start, bootstrap.end), context);
  return context;
}

test.each([
  null,
  {search: {desk: 73, min: 23, max: 48}},
])('bootstrap merges defaults into the latest settings under the lock: %p',
   async (stored) => {
     const context = loadBootstrap(stored);
     await context.bootstrapConfig();
     expect(context.atomicUpdate).toHaveBeenCalledTimes(1);
     const saved = context.applyStoredConfig.mock.calls[0][0];
     expect(saved.search.desk).toBe(stored?.search.desk || 31);
     if (stored) {
       expect(saved.search.min).toBe(23);
       expect(saved.search.max).toBe(48);
     }
     expect(saved.runtime.done).toBe(0);
     expect(context.applyStoredConfig).toHaveBeenCalledWith(saved, 'bootstrap');
     expect(context.ensureAlarms).toHaveBeenCalledTimes(1);
   });

test(
    'bootstrap persists migration flags while retaining custom settings',
    async () => {
      const context = loadBootstrap({
        search: {desk: 73, mob: 4, min: 23, max: 48},
        control: {niche: 'science'},
        futureSetting: {enabled: true},
      });
      await context.bootstrapConfig();
      const saved = context.applyStoredConfig.mock.calls[0][0];
      expect(saved.control.fastPacingDefaultApplied).toBe(2);
      expect(saved.control.niche).toBe('science');
      expect(saved.search).toEqual({desk: 73, mob: 4, min: 23, max: 48});
      expect(saved.futureSetting).toEqual({enabled: true});
    });

test(
    'bootstrap storage failure does not continue with unpersisted state',
    async () => {
      const context = loadBootstrap(null);
      context.atomicUpdate.mockRejectedValueOnce(new Error('Storage failed'));
      await context.bootstrapConfig();
      expect(context.applyStoredConfig).not.toHaveBeenCalled();
      expect(context.ensureAlarms).not.toHaveBeenCalled();
      expect(context.log)
          .toHaveBeenCalledWith(
              expect.stringContaining('Storage failed'), 'error');
    });

test(
    'background consumes normalized runtime instead of spreading raw storage back',
    () => {
      const apply = parse(source, {ecmaVersion: 2022, sourceType: 'module'})
                        .body.find(
                            (node) => node.type === 'FunctionDeclaration' &&
                                node.id.name === 'applyConfig');
      const context = {
        config: createDefaultConfig(),
        createDefaultConfig,
        applyConfigDefaults,
        resetStaleSearchCounters: jest.fn(() => false),
        logs: false,
      };
      vm.createContext(context);
      vm.runInContext(source.slice(apply.start, apply.end), context);
      context.applyConfig({
        runtime: {running: '0', done: '8', act: 'false', currentSession: 'bad'},
        control: {log: '0'},
      });
      expect(context.config.runtime).toMatchObject({
        running: 0,
        done: 8,
        act: 0,
        currentSession: null,
      });
      expect(context.logs).toBe(false);
    });

test(
    'normalizing storage preserves the live background session counters',
    () => {
      const apply = parse(source, {ecmaVersion: 2022, sourceType: 'module'})
                        .body.find(
                            (node) => node.type === 'FunctionDeclaration' &&
                                node.id.name === 'applyConfig');
      const session = {id: 'live', type: 'search', startedAt: 0};
      const config = createDefaultConfig();
      Object.assign(
          config.runtime, {running: 1, done: 9, currentSession: session});
      const context = {
        config,
        createDefaultConfig,
        applyConfigDefaults,
        resetStaleSearchCounters: jest.fn(() => false),
        logs: false,
      };
      vm.createContext(context);
      vm.runInContext(source.slice(apply.start, apply.end), context);
      context.applyConfig(
          {search: {desk: '77'}, runtime: {running: '0', done: 0}});
      expect(context.config.runtime)
          .toMatchObject({running: 1, done: 9, currentSession: session});
      expect(context.config.search.desk).toBe(77);
    });

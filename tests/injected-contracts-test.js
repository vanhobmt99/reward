const {Linter} = require('eslint');
const globals = require('globals');
const {loadEsmModule} = require('./esm-loader');

const scripts = loadEsmModule('../js/injected-scripts.js');
const linter = new Linter();

test.each([
  ['createDailySetStateProbe', []],
  ['createRewardsSectionReadyProbe', ['daily set|keep earning']],
  ['createDashboardActivityScript', [['visited'], 2, true]],
  ['createEarnActivityScript', [['visited'], 2, false]],
  ['createSolveActivityScript', [true]],
  ['createClaimReadyScript', [true, true]],
  ['createSearchInputSyncScript', ['expected text']],
  ['createSearchInputClearScript', []],
])('%s serializes every dependency required by the page context',
   (name, args) => {
     const expression = scripts[name](...args);
     const messages = linter.verify(expression, {
       languageOptions:
           {ecmaVersion: 2022, sourceType: 'script', globals: globals.browser},
       rules: {'no-undef': 'error'},
     });
     expect(messages.map((message) => `${message.line}: ${message.message}`))
         .toEqual([]);
   });

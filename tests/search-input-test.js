/** @jest-environment jsdom */
const {loadEsmModule} = require('./esm-loader');
const {createSearchInputSyncScript, createSearchInputClearScript} =
    loadEsmModule('../js/injected-scripts.js');

test.each([
  'same value',
  'quotes " and \' and \\ and\nnewlines',
  ');window.unexpected=true;//',
])('input repair preserves the literal expected value: %s', (expected) => {
  document.body.innerHTML = '<input id="sb_form_q">';
  const input = document.querySelector('input');
  input.type = 'search';
  // A textarea allows the newline fixture without native input sanitization.
  if (expected.includes('\n')) {
    document.body.innerHTML = '<textarea id="sb_form_q"></textarea>';
  }
  const field = document.querySelector('#sb_form_q');
  const changed = jest.fn();
  field.addEventListener('input', changed);
  const run = new Function(`return ${createSearchInputSyncScript(expected)};`);
  expect(run()).toEqual({repaired: true, value: expected});
  expect(field.value).toBe(expected);
  expect(document.activeElement).toBe(field);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(run()).toEqual({repaired: false, value: expected});
  expect(changed).toHaveBeenCalledTimes(1);
  expect(window.unexpected).toBeUndefined();
});

test(
    'input clearing emits one event and reports absent controls accurately',
    () => {
      document.body.innerHTML = '<input id="sb_form_q" value="previous">';
      const changed = jest.fn();
      document.querySelector('input').addEventListener('input', changed);
      const clear = new Function(`return ${createSearchInputClearScript()};`);
      expect(clear()).toBe(true);
      expect(document.querySelector('input').value).toBe('');
      expect(changed).toHaveBeenCalledTimes(1);
      document.body.innerHTML = '';
      expect(clear()).toBe(false);
      expect(new Function(`return ${createSearchInputSyncScript('value')};`)())
          .toBeNull();
    });

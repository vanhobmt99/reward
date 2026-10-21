/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');
const {parse} = require('acorn');

/**
 * Mounts the donate page and its production click handler.
 * @param {boolean=} configured Whether telemetry has a receiver.
 * @param {string=} outcome Mock send status.
 * @return {!{send: !Function, button: !Element}} Sender spy and button.
 */
function mount(configured = true, outcome = 'sent') {
  document.documentElement.innerHTML =
      fs.readFileSync(path.join(__dirname, '../donate.html'), 'utf8');
  const source =
      fs.readFileSync(path.join(__dirname, '../js/donate.js'), 'utf8');
  const ast = parse(source, {ecmaVersion: 2022, sourceType: 'module'});
  const body = ast.body.filter((node) => node.type !== 'ImportDeclaration')
                   .map((node) => source.slice(node.start, node.end))
                   .join('\n');
  const send = jest.fn().mockResolvedValue({status: outcome});
  // Execute the production event handlers with a mock receiver; no collection.
  const run = new Function(
      'document', 'window', 'sendTelemetryOnce', 'isTelemetryConfigured',
      'TELEMETRY_ENDPOINT', body);
  run(document, window, send, () => configured, 'https://mock.invalid');
  return {send, button: document.querySelector('#sendDeviceReport')};
}

test(
    'opening the page never sends; a disclosed button click passes consent',
    async () => {
      const {send, button} = mount();
      expect(send).not.toHaveBeenCalled();
      expect(document.querySelector('#deviceReportReceiver').textContent)
          .toBe('https://mock.invalid');
      expect(document.querySelector('#deviceReportTitle').textContent)
          .toContain('tùy chọn');
      button.click();
      expect(button.disabled).toBe(true);
      await Promise.resolve();
      expect(send).toHaveBeenCalledWith(
          'https://mock.invalid', {consent: true});
      expect(document.querySelector('#deviceReportStatus').textContent)
          .toContain('Đã gửi');
      expect(button.disabled).toBe(true);
    });

test('an unconfigured destination disables the send action', () => {
  const {send, button} = mount(false);
  expect(button.disabled).toBe(true);
  button.click();
  expect(send).not.toHaveBeenCalled();
});

test(
    'a failed send enables a user-initiated retry and announces the failure',
    async () => {
      const {send, button} = mount(true, 'failed');
      button.click();
      await Promise.resolve();
      expect(button.disabled).toBe(false);
      expect(document.querySelector('#deviceReportStatus').textContent)
          .toContain('Không gửi được');
      expect(send).toHaveBeenCalledTimes(1);
    });

const {loadEsmModule} = require('./esm-loader');
let withTimeout;
beforeEach(() => {
  jest.useFakeTimers();
  ({withTimeout} =
       loadEsmModule('../js/async-utils.js', {setTimeout, clearTimeout}));
});
afterEach(() => jest.useRealTimers());

test.each([NaN, Infinity, -1, 2147483648, '100'])(
    'invalid duration %s cannot start work or create a timer',
    async (duration) => {
      const operation = jest.fn();
      await expect(withTimeout(operation, duration))
          .rejects.toThrow('Invalid operation timeout');
      expect(operation).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    });

test('accepts synchronous operations and releases the deadline', async () => {
  await expect(withTimeout(() => 42, 100)).resolves.toBe(42);
  expect(jest.getTimerCount()).toBe(0);
});

test('zero duration is a real deadline, not the default duration', async () => {
  const pending = withTimeout(() => new Promise(() => {}), 0, 'expired');
  const rejected = expect(pending).rejects.toThrow('expired');
  await jest.advanceTimersByTimeAsync(0);
  await rejected;
  expect(jest.getTimerCount()).toBe(0);
});

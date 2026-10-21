/**
 * Bounds an operation without leaving a timer or an unhandled late rejection.
 * This stops waiting; it cannot cancel APIs that do not support cancellation.
 * Callers owning an AbortController or other resources must release them.
 * @template T
 * @param {function(): (T|Promise<T>)} operation Work to start after validation.
 * @param {number} timeoutMs Finite nonnegative browser timer duration.
 * @param {string=} message Error text when the deadline expires.
 * @return {!Promise<T>} Operation result or a deadline/operation error.
 */
export async function withTimeout(
    operation, timeoutMs, message = 'Operation timed out') {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 2147483647) {
    throw new RangeError('Invalid operation timeout');
  }
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([Promise.resolve().then(operation), timeout])
      .finally(() => clearTimeout(timer));
}

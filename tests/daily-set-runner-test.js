const {loadEsmModule} = require('./esm-loader');
const {runDailySet} = loadEsmModule('../js/daily-set-runner.js');

/**
 * Builds daily-set dependencies for one inspection status.
 * @param {string=} status Initial dashboard status.
 * @return {!Object} Inspect, scan, recover, and activity callbacks.
 */
function deps(status = 'pending') {
  return {
    inspect: jest.fn().mockResolvedValue({status}),
    scan: jest.fn().mockResolvedValue({clicked: 0, processed: 0}),
    recover: jest.fn(),
    /**
     * Reports that the daily-set run may continue.
     * @return {boolean} Whether the runner should keep going.
     */
    active: () => true,
    onPass: jest.fn(),
  };
}

test('three empty scans trigger recovery, not success', async () => {
  const d = deps();
  d.recover.mockImplementation(
      () => d.inspect.mockResolvedValue({status: 'complete'}),
  );
  expect((await runDailySet(d)).complete).toBe(true);
  expect(d.scan).toHaveBeenCalledTimes(3);
  expect(d.recover).toHaveBeenCalledTimes(1);
});

test(
    'repeated retry requests recover instead of keeping the click loop alive',
    async () => {
      const d = deps();
      d.scan.mockResolvedValue({clicked: 0, processed: 0, retry: true});
      const result = await runDailySet(d);
      expect(result.complete).toBe(false);
      expect(d.scan).toHaveBeenCalledTimes(9);
      expect(d.recover).toHaveBeenCalledTimes(2);
    });

test.each(['loading', 'unknown', 'pending'])(
    'persistent %s remains unsuccessful after bounded recovery',
    async (status) => {
      const d = deps(status);
      expect((await runDailySet(d)).complete).toBe(false);
      expect(d.recover).toHaveBeenCalledTimes(2);
      expect(d.scan).toHaveBeenCalledTimes(status === 'pending' ? 9 : 0);
    },
);

test('clicks and points alone never certify completion', async () => {
  const d = deps();
  d.scan.mockResolvedValue({clicked: 1, processed: 1, pointDelta: 10});
  expect((await runDailySet({...d, maxPasses: 4})).complete).toBe(false);
});

test('stop during inspection prevents further clicks and reloads', async () => {
  const d = deps();
  let active = true;
  /**
   * Stops the run after the first inspection.
   * @return {boolean} Whether the runner should keep going.
   */
  d.active = () => active;
  d.inspect.mockImplementation(async () => {
    active = false;
    return {status: 'pending'};
  });
  expect((await runDailySet(d)).reason).toBe('stopped');
  expect(d.scan).not.toHaveBeenCalled();
  expect(d.recover).not.toHaveBeenCalled();
});

test('a completed set is accepted without another click', async () => {
  const d = deps('complete');
  expect((await runDailySet(d)).complete).toBe(true);
  expect(d.scan).not.toHaveBeenCalled();
});

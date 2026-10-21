const {loadEsmModule} = require('./esm-loader');
const utils = loadEsmModule('../js/utils.js');

describe('Rewards counter helpers', () => {
  const {
    isRewardsSearchCounterComplete,
    getRewardsSearchCounterDone,
    isDailySearchCounterDone,
  } = utils;

  test('uses the same aliases and tier fallback as score snapshots', () => {
    expect(isRewardsSearchCounterComplete([
      {attributes: {pointProgress: 60, pointProgressMax: 60}},
      {attributes: {label: 'unrelated metadata'}},
    ])).toBe(true);
    expect(isRewardsSearchCounterComplete([
      {attributes: {complete: 1, currentProgress: 18, maxProgress: 60}},
    ])).toBe(false);
  });

  test('treats complete=1 as done', () => {
    expect(isRewardsSearchCounterComplete([{complete: 1}])).toBe(true);
    expect(
        getRewardsSearchCounterDone({pcSearch: [{complete: 1}]}, 'pcSearch'),
        )
        .toBe(1);
  });

  test(
      'boolean completion remains valid while boolean numeric fields do not',
      () => {
        expect(isRewardsSearchCounterComplete([{complete: true}])).toBe(true);
        expect(isRewardsSearchCounterComplete([{complete: false}])).toBe(false);
        expect(isRewardsSearchCounterComplete([{progress: true, max: true}]))
            .toBe(false);
      });

  test('treats partial progress below max as not done', () => {
    expect(
        isRewardsSearchCounterComplete([{complete: 0, progress: 5, max: 30}]),
        )
        .toBe(false);
    expect(
        getRewardsSearchCounterDone(
            {pcSearch: [{progress: 5, max: 30}]},
            'pcSearch',
            ),
        )
        .toBe(0);
  });

  test('treats progress >= max as done', () => {
    expect(isRewardsSearchCounterComplete([{progress: 30, max: 30}]))
        .toBe(
            true,
        );
  });

  test(
      'is not done while any tier still has room, whatever order Bing sends',
      () => {
        // Regression: the live 18/60 mobile tier was ignored because a
        // completed tier happened to sit at index 0, so the run skipped
        // searching entirely.
        const mobileTiers = [
          {attributes: {complete: 1, progress: 30, max: 30}},
          {attributes: {complete: 0, progress: 18, max: 60}},
        ];
        expect(isRewardsSearchCounterComplete(mobileTiers)).toBe(false);
        expect(
            getRewardsSearchCounterDone(
                {mobileSearch: mobileTiers},
                'mobileSearch',
                ),
            )
            .toBe(0);
      });

  test('is done only once every tier is full', () => {
    expect(
        isRewardsSearchCounterComplete([
          {attributes: {progress: 30, max: 30}},
          {attributes: {progress: 90, max: 90}},
        ]),
        )
        .toBe(true);
  });

  test('ignores a stale complete flag on a tier that still has room', () => {
    expect(
        isRewardsSearchCounterComplete([{complete: 1, progress: 18, max: 60}]),
        )
        .toBe(false);
  });

  test('treats an empty or all-null counter array as not done', () => {
    expect(isRewardsSearchCounterComplete([])).toBe(false);
    expect(isRewardsSearchCounterComplete([null])).toBe(false);
    expect(isRewardsSearchCounterComplete(null)).toBe(false);
  });

  test('isDailySearchCounterDone only accepts completed flags', () => {
    expect(isDailySearchCounterDone(1)).toBe(true);
    expect(isDailySearchCounterDone(0)).toBe(false);
    expect(isDailySearchCounterDone(0.5)).toBe(false);
  });
});

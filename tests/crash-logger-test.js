const {loadEsmModule} = require('./esm-loader');

/**
 * Loads the crash logger against an in-memory storage mock.
 * @return {!{stored: !Object, logger: !Object}} Storage bag and logger.
 */
function loadLogger() {
  const stored = {};
  const chrome = {
    runtime: {},
    storage: {
      local: {
        /**
         * Reads one stored value through the callback storage API.
         * @param {string} key Storage key.
         * @param {function(!Object): undefined} callback Receives the record.
         * @return {undefined} The callback delivers the stored record.
         */
        get: (key, callback) => callback({[key]: stored[key]}),
        /**
         * Merges values into storage and then signals completion.
         * @param {!Object} values Fields to store.
         * @param {function(): undefined} callback Completion callback.
         */
        set: (values, callback) => {
          Object.assign(stored, values);
          callback();
        },
      },
    },
  };
  return {
    stored,
    logger: loadEsmModule('../js/crash-logger.js', {
      chrome,
      console: {error: jest.fn()},
      self: {addEventListener: jest.fn()},
      Date,
      JSON,
      Promise,
    }),
  };
}

test(
    'handled activity restrictions are diagnostic events, not crashes',
    async () => {
      const {stored, logger} = loadLogger();
      await logger.recordEvent(
          'activity-access',
          'The extensions gallery cannot be scripted.',
          {code: 'browser_access_blocked'},
      );
      expect(stored._crashLog).toEqual([
        expect.objectContaining({
          level: 'event',
          context: 'activity-access',
          message: 'The extensions gallery cannot be scripted.',
        }),
      ]);
    });

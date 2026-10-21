/**
 * Serialized into an extension page/worker by both browser smoke runners.
 * Each edit yields after reading to expose lost updates if locking is removed.
 * Uses only the isolated test profile; no real settings or accounts are
 * touched.
 * @param {{url: string, count: number}} options Actual utils module and work
 *     size.
 * @return {!Promise<void>} Resolves after all increments are stored.
 */
async function incrementConfigInBrowser({url, count}) {
  const {atomicUpdate} = await import(url);
  for (let index = 0; index < count; index++) {
    await atomicUpdate(async (config) => {
      const next = (config.storageSmokeCount || 0) + 1;
      await new Promise((resolve) => setTimeout(resolve, 0));
      return {...config, storageSmokeCount: next};
    });
  }
}

module.exports = {incrementConfigInBrowser};

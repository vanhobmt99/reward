import {withTimeout} from '/js/async-utils.js';
import {createDynamicTopicCache, readFreshDynamicTopicCache, normalizeTopicList, DYNAMIC_TOPIC_CACHE_TTL_MS} from '/js/query-sources.js';

const FAILURE_RETRY_MS = 5 * 60 * 1000;
const CACHE_READ_TIMEOUT_MS = 1500;
const FETCH_TIMEOUT_MS = 6000;

/** @typedef {{languageCode: string, regionCode: string}} TopicLocale */
/**
 * @typedef {{savedAt: number, languageCode: string, regionCode: string,
 *     topics: !Array<string>}} TopicCacheRecord
 */
/**
 * @typedef {{read: function(): !Promise<*>,
 *     write: function(!TopicCacheRecord): !Promise<void>,
 *     fetchTopics: function(!TopicLocale): !Promise<!Array<string>>,
 *     now: (undefined|function(): number),
 *     onRefresh: (undefined|function(): void),
 *     log: (undefined|function(string, string=): void)}} TopicCacheDependencies
 */
/**
 * @typedef {{prefetch: function(!TopicLocale): !Promise<!Array<string>>,
 *     peek: function(): !Array<string>}} TopicCache
 */

/**
 * Owns one locale's memory cache and in-flight request. Entry identity, rather
 * than the locale string alone, prevents stale A→B→A responses from winning.
 * Persistence is serialized and does not delay consumers. A hung storage write
 * can stall subsequent persistence, but cannot hold the memory cache or UI.
 * @param {!TopicCacheDependencies} deps Storage, network and optional
 *     observers.
 * @return {!TopicCache} Cache access without exposing mutable request state.
 */
export function createTopicCache(deps) {
  const {read, write, fetchTopics, now = Date.now, onRefresh = () => {}} = deps;
  let current = null;
  let writeQueue = Promise.resolve();

  /**
   * @param {string} message Diagnostic text.
   * @param {string=} level Log category.
   */
  function notify(message, level = 'update') {
    try {
      deps.log?.(message, level);
    } catch {
      // Diagnostics must not change the cache result or leave a rejected task.
    }
  }

  /**
   * @param {!TopicLocale} locale Requested source locale.
   * @return {!Promise<!Array<string>>} Current topics, shared in-flight work or
   *     fallback.
   */
  function prefetch(locale) {
    const requestedLocale = {...locale};
    const key = `${locale.languageCode}:${locale.regionCode}`;
    const age =
        current?.loadedAt === null ? Infinity : now() - current?.loadedAt;
    const ttl =
        current?.topics.length ? DYNAMIC_TOPIC_CACHE_TTL_MS : FAILURE_RETRY_MS;
    if (current?.key === key) {
      if (current.pending) {
        return current.promise;
      }
      if (age >= 0 && age <= ttl) {
        return Promise.resolve([...current.topics]);
      }
    }

    const entry =
        {key, topics: [], loadedAt: null, pending: true, promise: null};
    current = entry;
    try {
      onRefresh();
    } catch {
      notify('Topic refresh observer failed.', 'warning');
    }
    entry.promise =
        (async () => {
          try {
            const cached = await withTimeout(read, CACHE_READ_TIMEOUT_MS);
            if (current !== entry) {
              return [];
            }
            const topics = readFreshDynamicTopicCache(
                cached, now(), DYNAMIC_TOPIC_CACHE_TTL_MS, requestedLocale);
            if (topics.length > 0) {
              entry.topics = topics;
              entry.loadedAt = cached.savedAt;
              notify(`Loaded ${topics.length} background topics from cache.`);
              return topics;
            }
          } catch (error) {
            notify(
                `Dynamic topic cache unavailable: ${error?.message || error}`,
                'warning');
          }
          if (current !== entry) {
            return [];
          }
          const topics = normalizeTopicList(await withTimeout(
              () => fetchTopics(requestedLocale), FETCH_TIMEOUT_MS));
          if (current !== entry) {
            return [];
          }
          entry.topics = topics;
          entry.loadedAt = now();
          if (topics.length === 0) {
            notify(
                'Live topic sources unavailable; using the local pool.',
                'warning');
            return topics;
          }
          const record =
              createDynamicTopicCache(topics, entry.loadedAt, requestedLocale);
          writeQueue = writeQueue
                           .then(async () => {
                             if (current === entry) {
                               await write(record);
                             }
                           })
                           .catch((error) => {
                             notify(
                                 `Could not cache dynamic topics: ${
                                     error?.message || error}`,
                                 'warning');
                           });
          notify(`Prepared ${topics.length} live topics in the background.`);
          return topics;
        })().then((topics) => [...topics])
            .catch((error) => {
              if (current !== entry) {
                return [];
              }
              entry.topics = [];
              entry.loadedAt = now();
              notify(
                  `Background topic preparation failed: ${
                      error?.message || error}`,
                  'warning');
              return [];
            })
            .finally(() => {
              entry.pending = false;
            });
    return entry.promise;
  }

  return {
    prefetch,
    /**
     * @return {!Array<string>} Current topics; callers cannot mutate the
     * cache.
     */
    peek() {
      return current ? [...current.topics] : [];
    },
  };
}

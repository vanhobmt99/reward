/**
 * Parse Microsoft Rewards getuserinfo payloads into clickable daily-set /
 * keep-earning offers. The 2026 dashboard moved those cards off /dashboard
 * onto /earn; the API still lists destinationUrl even when the DOM heading
 * the old scanner looked for is gone.
 */

/**
 * @typedef {{destination: (string|undefined)}} RewardsOfferAttributes
 */
/**
 * @typedef {{offerId: (string|undefined), title: (string|undefined),
 *     name: (string|undefined), description: (string|undefined),
 *     destinationUrl: (string|undefined), destination: (string|undefined),
 *     attributes: (!RewardsOfferAttributes|undefined),
 *     exclusiveLockedFeatureStatus: (string|undefined),
 *     lockedStatus: (string|undefined), isLocked: (boolean|undefined),
 *     complete: (boolean|undefined),
 *     pointProgress: (number|string|undefined),
 *     pointProgressMax: (number|string|undefined),
 *     pointMax: (number|string|undefined), promotionType: (string|undefined),
 *     activityType: (string|undefined)}} RewardsOfferItem
 */
/**
 * @typedef {{dailySetPromotions:
 * (!Object<string, !Array<?RewardsOfferItem>>|undefined), morePromotions:
 * (!Array<?RewardsOfferItem>|undefined), dashboard:
 * (!RewardsDashboard|undefined)}} RewardsDashboard
 */
/**
 * @typedef {{key: string, category: string, title: string, url: string,
 *     promotionType: string, points: number, visitCompletes: boolean}}
 *     PendingOffer
 */

/**
 * Walks an API object graph once, including arrays.
 * @param {?RewardsDashboard} source Root value. Primitives and repeats are
 *     skipped.
 * @param {function(!RewardsDashboard|!RewardsOfferItem|
 *     !Array<?RewardsOfferItem>): void} visit Called for each object or array.
 */
function walkObjects(source, visit) {
  const queue = [source];
  const seen = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) {
      continue;
    }
    seen.add(current);
    visit(current);
    if (Array.isArray(current)) {
      for (const item of current) {
        queue.push(item);
      }
    } else {
      for (const value of Object.values(current)) {
        queue.push(value);
      }
    }
  }
}

/**
 * Finds the object that lists daily-set or keep-earning promotions.
 * @param {?RewardsDashboard} payload getuserinfo root or a nested dashboard.
 * @return {?RewardsDashboard} Promotion owner, or null when none is present.
 */
export function findDashboardPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  if (payload.dailySetPromotions || payload.morePromotions) {
    return payload;
  }
  if (payload.dashboard && typeof payload.dashboard === 'object') {
    return payload.dashboard;
  }
  let found = null;
  walkObjects(payload, (node) => {
    if (found || Array.isArray(node)) {
      return;
    }
    if (node.dailySetPromotions || node.morePromotions) {
      found = node;
    }
  });
  return found;
}

/**
 * Builds the date keys Microsoft has used for today's daily set.
 * @param {!Date=} now Calendar date. Defaults to the current local date.
 * @return {!Set<string>} Month/day/year and ISO keys for that date.
 */
export function promotionDateKeys(now = new Date()) {
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const year = now.getFullYear();
  return new Set([
    `${month}/${day}/${year}`,
    `${month}/${String(day).padStart(2, '0')}/${year}`,
    `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`,
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  ]);
}

/**
 * @param {?RewardsOfferItem} item Promotion record.
 * @return {boolean} Whether the card is locked and must not be clicked.
 */
export function isLockedOffer(item) {
  const status =
      String(
          item?.exclusiveLockedFeatureStatus || item?.lockedStatus || '',
          )
          .toLowerCase();
  if (status === 'locked') {
    return true;
  }
  return item?.isLocked === true;
}

/**
 * @param {?RewardsOfferItem} item Promotion record.
 * @return {boolean} Whether the card already reached its point maximum.
 */
export function isCompleteOffer(item) {
  if (item?.complete === true) {
    return true;
  }
  const progress = Number(item?.pointProgress);
  const max = Number(item?.pointProgressMax ?? item?.pointMax);
  return (
      Number.isFinite(progress) && Number.isFinite(max) && max > 0 &&
      progress >= max);
}

/**
 * @param {?RewardsOfferItem} item Promotion record.
 * @return {string} Absolute Rewards or Bing URL, or an empty string.
 */
export function offerUrl(item) {
  const raw = item?.destinationUrl || item?.destination ||
      item?.attributes?.destination || '';
  const url = String(raw || '').trim();
  if (!url) {
    return '';
  }
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  if (url.startsWith('/')) {
    return `https://rewards.bing.com${url}`;
  }
  return `https://rewards.bing.com/${url.replace(/^\.\//, '')}`;
}

/**
 * @param {?RewardsOfferItem} item Promotion record.
 * @return {number} Points still available, never negative.
 */
function offerPoints(item) {
  const max = Number(item?.pointProgressMax ?? item?.pointMax);
  const progress = Number(item?.pointProgress);
  if (Number.isFinite(max) && Number.isFinite(progress)) {
    return Math.max(0, max - progress);
  }
  if (Number.isFinite(max)) {
    return Math.max(0, max);
  }
  return 0;
}

/**
 * @param {string} type Promotion or activity type. Empty when the API omitted
 *     it.
 * @param {string} url Destination URL.
 * @return {boolean} Whether opening the URL is enough to complete the offer.
 */
export function isVisitCompleteType(type, url) {
  if (/urlreward|url.?reward|exploreonbing|searchonbing/i.test(type || '')) {
    return true;
  }
  try {
    const parsed = new URL(String(url || ''));
    const host = parsed.hostname.toLowerCase();
    return (
        (host === 'bing.com' || host.endsWith('.bing.com')) &&
        /^\/search\/?$/i.test(parsed.pathname));
  } catch {
    return false;
  }
}

/**
 * Drops locked, complete, and identity-less promotions.
 * @param {?RewardsOfferItem} item Raw promotion.
 * @param {string} category Pass label stored in the key, such as "daily-set".
 * @return {?PendingOffer} Clickable offer, or null when it should be skipped.
 */
function normalizeOffer(item, category) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  if (isLockedOffer(item) || isCompleteOffer(item)) {
    return null;
  }
  const points = offerPoints(item);
  const url = offerUrl(item);
  if (!url && points <= 0) {
    return null;
  }
  const title = String(
                    item.title || item.name || item.description || '',
                    )
                    .trim();
  const type = String(
                   item.promotionType || item.activityType || '',
                   )
                   .toLowerCase();
  const identity = String(item.offerId || item.name || url || title);
  if (!identity) {
    return null;
  }
  return {
    key: `${category}|${identity}`,
    category,
    title: title.slice(0, 120),
    url,
    promotionType: type,
    points,
    visitCompletes: isVisitCompleteType(type, url),
  };
}

/**
 * Collects today's incomplete daily-set cards and pending keep-earning cards.
 * @param {?RewardsDashboard} payload getuserinfo root or dashboard object.
 * @param {!Date=} now Date used to choose the daily-set key. Defaults to now.
 * @return {!Array<!PendingOffer>} Offers in dashboard order, without duplicate
 *     keys.
 */
export function collectPendingOffers(payload, now = new Date()) {
  const dashboard = findDashboardPayload(payload);
  const offers = [];
  const seen = new Set();
  /**
   * @param {?RewardsOfferItem} item Raw promotion.
   * @param {string} category "daily-set" or "keep-earning".
   */
  const add = (item, category) => {
    const offer = normalizeOffer(item, category);
    if (!offer || seen.has(offer.key)) {
      return;
    }
    seen.add(offer.key);
    offers.push(offer);
  };

  const daily = dashboard?.dailySetPromotions;
  if (daily && typeof daily === 'object') {
    const todayKeys = promotionDateKeys(now);
    const matched = Object.keys(daily).filter((key) => todayKeys.has(key));
    const useKeys = matched.length > 0 ? matched : Object.keys(daily);
    for (const key of useKeys) {
      const list = daily[key];
      if (!Array.isArray(list)) {
        continue;
      }
      for (const item of list) {
        add(item, 'daily-set');
      }
    }
  }

  const more = dashboard?.morePromotions;
  if (Array.isArray(more)) {
    for (const item of more) {
      add(item, 'keep-earning');
    }
  }

  return offers;
}

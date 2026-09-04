/**
 * Parse Microsoft Rewards getuserinfo payloads into clickable daily-set /
 * keep-earning offers. The 2026 dashboard moved those cards off /dashboard
 * onto /earn; the API still lists destinationUrl even when the DOM heading
 * the old scanner looked for is gone.
 */

function walkObjects(source, visit) {
  const queue = [source];
  const seen = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    visit(current);
    if (Array.isArray(current)) {
      for (const item of current) queue.push(item);
    } else {
      for (const value of Object.values(current)) queue.push(value);
    }
  }
}

export function findDashboardPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.dailySetPromotions || payload.morePromotions) return payload;
  if (payload.dashboard && typeof payload.dashboard === "object") {
    return payload.dashboard;
  }
  let found = null;
  walkObjects(payload, (node) => {
    if (found || Array.isArray(node)) return;
    if (node.dailySetPromotions || node.morePromotions) found = node;
  });
  return found;
}

export function promotionDateKeys(now = new Date()) {
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const year = now.getFullYear();
  return new Set([
    `${month}/${day}/${year}`,
    `${month}/${String(day).padStart(2, "0")}/${year}`,
    `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}/${year}`,
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  ]);
}

export function isLockedOffer(item) {
  const status = String(
    item?.exclusiveLockedFeatureStatus || item?.lockedStatus || "",
  ).toLowerCase();
  if (status === "locked") return true;
  return item?.isLocked === true;
}

export function isCompleteOffer(item) {
  if (item?.complete === true) return true;
  const progress = Number(item?.pointProgress);
  const max = Number(item?.pointProgressMax ?? item?.pointMax);
  return (
    Number.isFinite(progress) &&
    Number.isFinite(max) &&
    max > 0 &&
    progress >= max
  );
}

export function offerUrl(item) {
  const raw =
    item?.destinationUrl ||
    item?.destination ||
    item?.attributes?.destination ||
    "";
  const url = String(raw || "").trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/")) return `https://rewards.bing.com${url}`;
  return `https://rewards.bing.com/${url.replace(/^\.\//, "")}`;
}

export function offerPoints(item) {
  const max = Number(item?.pointProgressMax ?? item?.pointMax);
  const progress = Number(item?.pointProgress);
  if (Number.isFinite(max) && Number.isFinite(progress)) {
    return Math.max(0, max - progress);
  }
  if (Number.isFinite(max)) return Math.max(0, max);
  return 0;
}

export function isVisitCompleteType(type, url) {
  if (/urlreward|url.?reward|exploreonbing|searchonbing/i.test(type || "")) {
    return true;
  }
  try {
    const parsed = new URL(String(url || ""));
    const host = parsed.hostname.toLowerCase();
    return (
      (host === "bing.com" || host.endsWith(".bing.com")) &&
      /^\/search\/?$/i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

export function normalizeOffer(item, category) {
  if (!item || typeof item !== "object") return null;
  if (isLockedOffer(item) || isCompleteOffer(item)) return null;
  const points = offerPoints(item);
  const url = offerUrl(item);
  if (!url && points <= 0) return null;
  const title = String(
    item.title || item.name || item.description || "",
  ).trim();
  const type = String(item.promotionType || item.activityType || "").toLowerCase();
  const identity = String(item.offerId || item.name || url || title);
  if (!identity) return null;
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

export function collectPendingOffers(payload, now = new Date()) {
  const dashboard = findDashboardPayload(payload);
  const offers = [];
  const seen = new Set();
  const add = (item, category) => {
    const offer = normalizeOffer(item, category);
    if (!offer || seen.has(offer.key)) return;
    seen.add(offer.key);
    offers.push(offer);
  };

  const daily = dashboard?.dailySetPromotions;
  if (daily && typeof daily === "object") {
    const todayKeys = promotionDateKeys(now);
    const matched = Object.keys(daily).filter((key) => todayKeys.has(key));
    const useKeys = matched.length > 0 ? matched : Object.keys(daily);
    for (const key of useKeys) {
      const list = daily[key];
      if (!Array.isArray(list)) continue;
      for (const item of list) add(item, "daily-set");
    }
  }

  const more = dashboard?.morePromotions;
  if (Array.isArray(more)) {
    for (const item of more) add(item, "keep-earning");
  }

  return offers;
}

export const ACTIVITY_EARN_PATH = "earn";
export const ACTIVITY_HOME_PATH = "";
export const ACTIVITY_DASHBOARD_PATH = "dashboard";

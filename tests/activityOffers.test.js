"use strict";

const { loadEsmModule } = require("./esm-loader.js");

const {
  findDashboardPayload,
  promotionDateKeys,
  isLockedOffer,
  isCompleteOffer,
  offerUrl,
  collectPendingOffers,
  isVisitCompleteType,
} = loadEsmModule("../js/activity-offers.js", { URL });

describe("findDashboardPayload()", () => {
  test("returns a payload that already has promotions", () => {
    const payload = { dailySetPromotions: {}, morePromotions: [] };
    expect(findDashboardPayload(payload)).toBe(payload);
  });

  test("unwraps nested dashboard objects", () => {
    const dashboard = { morePromotions: [{ offerId: "a" }] };
    expect(findDashboardPayload({ status: { dashboard } })).toBe(dashboard);
  });
});

describe("promotionDateKeys()", () => {
  test("includes unpadded and padded US dates", () => {
    const keys = promotionDateKeys(new Date(2026, 8, 4));
    expect(keys.has("9/4/2026")).toBe(true);
    expect(keys.has("09/04/2026")).toBe(true);
    expect(keys.has("2026-09-04")).toBe(true);
  });
});

describe("offer filters", () => {
  test("treats locked and completed items as ineligible", () => {
    expect(isLockedOffer({ exclusiveLockedFeatureStatus: "locked" })).toBe(
      true,
    );
    expect(isCompleteOffer({ complete: true })).toBe(true);
    expect(
      isCompleteOffer({ pointProgress: 10, pointProgressMax: 10 }),
    ).toBe(true);
    expect(
      isCompleteOffer({ pointProgress: 0, pointProgressMax: 10 }),
    ).toBe(false);
  });

  test("absolutizes relative destination URLs", () => {
    expect(offerUrl({ destinationUrl: "/quiz/abc" })).toBe(
      "https://rewards.bing.com/quiz/abc",
    );
    expect(offerUrl({ destination: "https://www.bing.com/search?q=x" })).toBe(
      "https://www.bing.com/search?q=x",
    );
  });
});

describe("collectPendingOffers()", () => {
  const now = new Date(2026, 8, 4);

  test("returns today's incomplete daily set and keep-earning offers", () => {
    const offers = collectPendingOffers(
      {
        dashboard: {
          dailySetPromotions: {
            "9/4/2026": [
              {
                offerId: "quiz-1",
                title: "Daily quiz",
                destinationUrl: "https://www.bing.com/search?q=quiz&form=dsetqu",
                pointProgress: 0,
                pointProgressMax: 10,
                promotionType: "quiz",
              },
              {
                offerId: "done",
                title: "Already done",
                destinationUrl: "https://www.bing.com/search?q=done",
                complete: true,
                pointProgressMax: 10,
              },
            ],
            "9/3/2026": [
              {
                offerId: "yesterday",
                title: "Old",
                destinationUrl: "https://www.bing.com/search?q=old",
                pointProgressMax: 10,
              },
            ],
          },
          morePromotions: [
            {
              offerId: "poll-1",
              title: "This or that",
              destinationUrl: "/poll/this",
              pointProgress: 0,
              pointProgressMax: 5,
              promotionType: "poll",
            },
            {
              offerId: "locked",
              title: "Gold only",
              destinationUrl: "/gold",
              exclusiveLockedFeatureStatus: "locked",
              pointProgressMax: 50,
            },
          ],
        },
      },
      now,
    );

    expect(offers.map((o) => o.key)).toEqual([
      "daily-set|quiz-1",
      "keep-earning|poll-1",
    ]);
    expect(offers[0].visitCompletes).toBe(true);
    expect(offers[1].url).toBe("https://rewards.bing.com/poll/this");
  });

  test("falls back to every daily-set date when today's key is missing", () => {
    const offers = collectPendingOffers(
      {
        dailySetPromotions: {
          "4/9/2026": [
            {
              offerId: "odd-format",
              title: "Odd date key",
              destinationUrl: "https://www.bing.com/search?q=odd",
              pointProgressMax: 10,
            },
          ],
        },
      },
      now,
    );
    expect(offers).toHaveLength(1);
    expect(offers[0].key).toBe("daily-set|odd-format");
  });
});

describe("isVisitCompleteType()", () => {
  test("urlreward and Bing search URLs complete by visiting", () => {
    expect(isVisitCompleteType("urlreward", "")).toBe(true);
    expect(
      isVisitCompleteType(
        "quiz",
        "https://www.bing.com/search?q=Trip+to+Santorini&FORM=tgrew4",
      ),
    ).toBe(true);
    expect(isVisitCompleteType("quiz", "https://rewards.bing.com/quiz/1")).toBe(
      false,
    );
  });
});

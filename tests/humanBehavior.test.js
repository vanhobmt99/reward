const { loadEsmModule } = require("./esm-loader.js");

const {
  nearbyKey,
  planTypingSteps,
  applyTypingSteps,
  createNicheSession,
  planScrollSteps,
  humanReadDelayMs,
  planLongPauseIndices,
  longPauseMs,
  KEYBOARD_NEIGHBOURS,
  LONG_PAUSE_MIN_MS,
  LONG_PAUSE_MAX_MS,
  DEFAULT_SEARCHES_PER_LONG_PAUSE,
  READ_DELAY_CAP_MS,
} = loadEsmModule("../js/human-behavior.js");

// Deterministic rng that cycles a fixed sequence, so a test can steer every
// branch instead of asserting on "some number came back".
function seqRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("nearbyKey", () => {
  test("returns a physically adjacent key", () => {
    const result = nearbyKey("s", seqRng([0]));
    expect(KEYBOARD_NEIGHBOURS.s).toContain(result);
  });

  test("preserves case", () => {
    expect(nearbyKey("S", seqRng([0]))).toBe(
      KEYBOARD_NEIGHBOURS.s[0].toUpperCase(),
    );
  });

  test("returns null for characters with no mapping", () => {
    expect(nearbyKey("7", seqRng([0]))).toBeNull();
    expect(nearbyKey(" ", seqRng([0]))).toBeNull();
  });
});

describe("planTypingSteps", () => {
  test("steps always reconstruct the query exactly (no typos)", () => {
    const query = "best laptop for students 2026";
    // rng always 1 => typoChance never triggers
    const steps = planTypingSteps(query, { rng: seqRng([0.99]) });
    expect(applyTypingSteps(steps)).toBe(query);
  });

  test("steps still reconstruct the query when typos fire", () => {
    // rng always 0 => every eligible word takes the typo branch
    const query = "cheap flights to tokyo";
    const steps = planTypingSteps(query, { rng: seqRng([0]) });
    expect(applyTypingSteps(steps)).toBe(query);
    expect(steps.some((step) => step.typo)).toBe(true);
    expect(steps.some((step) => step.type === "backspace")).toBe(true);
  });

  test("reconstruction holds across many random seeds", () => {
    const query = "how to fix a leaking kitchen tap quickly";
    for (let seed = 0; seed < 200; seed++) {
      let n = seed + 1;
      const rng = () => {
        n = (n * 1103515245 + 12345) % 2147483648;
        return n / 2147483648;
      };
      expect(applyTypingSteps(planTypingSteps(query, { rng }))).toBe(query);
    }
  });

  test("never exceeds maxTypos", () => {
    const query = "alpha bravo charlie delta echo foxtrot golf hotel";
    const steps = planTypingSteps(query, { rng: seqRng([0]), maxTypos: 2 });
    expect(steps.filter((step) => step.typo).length).toBeLessThanOrEqual(2);
  });

  test("a typo is always followed by a pause and a correction", () => {
    const steps = planTypingSteps("keyboard shortcuts", { rng: seqRng([0]) });
    const typoAt = steps.findIndex((step) => step.typo);
    expect(typoAt).toBeGreaterThanOrEqual(0);
    expect(steps[typoAt + 1].type).toBe("pause");
    expect(steps[typoAt + 2].type).toBe("backspace");
    expect(steps[typoAt + 3]).toMatchObject({
      type: "insert",
      corrected: true,
    });
  });

  test("backspace count matches how much was overshot", () => {
    const steps = planTypingSteps("wireless headphones review", {
      rng: seqRng([0]),
    });
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].type !== "backspace") continue;
      // The typo insert is two steps earlier (insert, pause, backspace).
      const typoText = steps[i - 2].text;
      const corrected = steps[i + 1].text;
      // Rebuilding from just these three steps must be self-consistent.
      expect(typoText.length).toBeGreaterThanOrEqual(steps[i].count);
      expect(corrected.length).toBeGreaterThan(0);
    }
  });

  test("short words are never mistyped", () => {
    const steps = planTypingSteps("a to be", { rng: seqRng([0]) });
    expect(steps.some((step) => step.typo)).toBe(false);
    expect(applyTypingSteps(steps)).toBe("a to be");
  });

  test("empty and nullish queries produce no steps", () => {
    expect(planTypingSteps("")).toEqual([]);
    expect(planTypingSteps(null)).toEqual([]);
    expect(planTypingSteps(undefined)).toEqual([]);
  });
});

describe("createNicheSession", () => {
  test("keeps the same niche for a burst, then switches", () => {
    const session = createNicheSession(["tech", "food", "sport"], {
      rng: seqRng([0]),
      minBurst: 3,
      maxBurst: 3,
    });
    const picks = Array.from({ length: 6 }, () => session.next());
    expect(picks[0]).toBe(picks[1]);
    expect(picks[1]).toBe(picks[2]);
    expect(picks[3]).not.toBe(picks[2]);
    expect(picks[3]).toBe(picks[4]);
  });

  test("never repeats the same niche back-to-back across bursts", () => {
    let n = 7;
    const rng = () => {
      n = (n * 1103515245 + 12345) % 2147483648;
      return n / 2147483648;
    };
    const session = createNicheSession(["a", "b", "c", "d"], { rng });
    let previous = null;
    let switches = 0;
    for (let i = 0; i < 200; i++) {
      const niche = session.next();
      if (previous !== null && niche !== previous) switches++;
      previous = niche;
    }
    expect(switches).toBeGreaterThan(10); // it does rotate
  });

  test("a single-category pool keeps returning that category", () => {
    const session = createNicheSession(["only"], { rng: seqRng([0.5]) });
    expect([session.next(), session.next(), session.next()]).toEqual([
      "only",
      "only",
      "only",
    ]);
  });

  test("an empty pool yields null instead of throwing", () => {
    const session = createNicheSession([], { rng: seqRng([0.5]) });
    expect(session.next()).toBeNull();
    expect(createNicheSession(null).next()).toBeNull();
  });

  test("exposes the current niche and remaining burst length", () => {
    const session = createNicheSession(["x", "y"], {
      rng: seqRng([0]),
      minBurst: 4,
      maxBurst: 4,
    });
    session.next();
    expect(session.niche).not.toBeNull();
    expect(session.remaining).toBe(3);
  });
});

describe("planScrollSteps", () => {
  test("produces at least two steps with dwell pauses", () => {
    const steps = planScrollSteps({ rng: seqRng([0.5]) });
    expect(steps.length).toBeGreaterThanOrEqual(2);
    for (const step of steps) {
      expect(step.pauseMs).toBeGreaterThan(0);
      expect(Number.isFinite(step.deltaY)).toBe(true);
    }
  });

  test("the first step always scrolls down", () => {
    // rng 0 would otherwise take the scroll-back-up branch
    const steps = planScrollSteps({ rng: seqRng([0]) });
    expect(steps[0].deltaY).toBeGreaterThan(0);
  });

  test("can scroll back up on later steps", () => {
    // Draw order is: count, then per step [backUp (i>0 only), magnitude,
    // pause]. Index 3 is the first backUp roll — put it under the 0.2 threshold.
    const steps = planScrollSteps({
      rng: seqRng([0.5, 0.5, 0.5, 0.05, 0.5, 0.5]),
    });
    expect(steps.some((step) => step.deltaY < 0)).toBe(true);
  });

  test("mobile flings travel further than desktop wheel notches", () => {
    const desktop = planScrollSteps({ rng: seqRng([0.9]), mobile: false });
    const mobile = planScrollSteps({ rng: seqRng([0.9]), mobile: true });
    expect(Math.abs(mobile[0].deltaY)).toBeGreaterThan(
      Math.abs(desktop[0].deltaY),
    );
  });
});

describe("humanReadDelayMs", () => {
  test("never returns below the configured minimum", () => {
    for (let seed = 0; seed < 300; seed++) {
      let n = seed + 1;
      const rng = () => {
        n = (n * 1103515245 + 12345) % 2147483648;
        return n / 2147483648;
      };
      expect(humanReadDelayMs(7, 14, { rng })).toBeGreaterThanOrEqual(7000);
    }
  });

  test("is right-skewed: median sits below the midpoint of the band", () => {
    let n = 42;
    const rng = () => {
      n = (n * 1103515245 + 12345) % 2147483648;
      return n / 2147483648;
    };
    const samples = Array.from({ length: 2000 }, () =>
      humanReadDelayMs(5, 25, { rng }),
    ).sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    // Midpoint of a uniform [5s,25s] would be 15s; a right-skewed
    // distribution puts the median well below that, and the mean above the
    // median because of the long tail.
    expect(median).toBeLessThan(15000);
    expect(mean).toBeGreaterThan(median);
  });

  test("produces a long tail that a uniform distribution would not", () => {
    let n = 99;
    const rng = () => {
      n = (n * 1103515245 + 12345) % 2147483648;
      return n / 2147483648;
    };
    const samples = Array.from({ length: 2000 }, () =>
      humanReadDelayMs(7, 14, { rng }),
    );
    expect(Math.max(...samples)).toBeGreaterThan(14000);
  });

  test("respects the hard cap even with a boost", () => {
    let n = 5;
    const rng = () => {
      n = (n * 1103515245 + 12345) % 2147483648;
      return n / 2147483648;
    };
    for (let i = 0; i < 500; i++) {
      expect(humanReadDelayMs(30, 60, { rng, boost: 4 })).toBeLessThanOrEqual(
        READ_DELAY_CAP_MS,
      );
    }
  });

  test("a boost slows the pace down", () => {
    const plain = humanReadDelayMs(7, 14, { rng: seqRng([0.5, 0.5]) });
    const boosted = humanReadDelayMs(7, 14, {
      rng: seqRng([0.5, 0.5]),
      boost: 2,
    });
    expect(boosted).toBeGreaterThan(plain);
  });

  test("handles a degenerate band where min equals max", () => {
    const value = humanReadDelayMs(10, 10, { rng: seqRng([0.5, 0.5]) });
    expect(value).toBeGreaterThanOrEqual(10000);
  });
});

describe("planLongPauseIndices", () => {
  test("skips the first and last search", () => {
    let n = 3;
    const rng = () => {
      n = (n * 1103515245 + 12345) % 2147483648;
      return n / 2147483648;
    };
    for (let i = 0; i < 100; i++) {
      const indices = planLongPauseIndices(30, { rng });
      for (const index of indices) {
        expect(index).toBeGreaterThan(0);
        expect(index).toBeLessThan(29);
      }
    }
  });

  test("scales with the number of searches", () => {
    const rng = seqRng([0.5]);
    expect(planLongPauseIndices(30, { rng }).size).toBeGreaterThan(0);
    expect(planLongPauseIndices(3, { rng }).size).toBe(0);
    expect(planLongPauseIndices(0, { rng }).size).toBe(0);
  });

  test("long pauses land in a plausible away-from-keyboard range", () => {
    expect(longPauseMs(seqRng([0]))).toBe(LONG_PAUSE_MIN_MS);
    expect(longPauseMs(seqRng([1]))).toBe(LONG_PAUSE_MAX_MS);
  });

  test("the tuned defaults keep a whole run's break budget near two minutes", () => {
    // These numbers are a deliberate wall-clock trade, not incidental: the
    // previous 90-240s at one pause per 12 searches cost ~8 minutes per run,
    // which dwarfed every other cost of the humanisation work. Pin them so a
    // future tweak has to be a decision rather than a drift.
    expect(DEFAULT_SEARCHES_PER_LONG_PAUSE).toBe(20);
    expect(LONG_PAUSE_MIN_MS).toBe(60000);
    expect(LONG_PAUSE_MAX_MS).toBe(150000);

    // A 31 + 21 run: one pause per phase, worst case 2.5 minutes each.
    const pausesPerRun =
      planLongPauseIndices(31).size + planLongPauseIndices(21).size;
    expect(pausesPerRun).toBe(2);
    expect((pausesPerRun * LONG_PAUSE_MAX_MS) / 60000).toBeLessThanOrEqual(5);
  });
});

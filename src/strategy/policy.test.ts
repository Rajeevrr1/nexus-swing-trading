import { describe, expect, it } from "vitest";
import type { PriceBar } from "../analysis";
import {
  allowNewEntry,
  evaluateBarExit,
  evaluatePositionSignal,
  evaluateTrancheBarStep,
  evaluateTranchePlan,
  freezeEntryStop,
  FULL_PROFIT,
  isDeadMoneyTimeExit,
  maxSlotsForRegime,
  PROTECT_GAIN,
  ratchetStop,
  riskScaleForRegime,
  runnerStopLevel,
  sessionsHeld,
} from "./policy";

function bar(overrides: Partial<PriceBar> & Pick<PriceBar, "date" | "close">): PriceBar {
  const close = overrides.close;
  return {
    date: overrides.date,
    label: overrides.label ?? overrides.date,
    open: overrides.open ?? close,
    high: overrides.high ?? close,
    low: overrides.low ?? close,
    close,
    volume: overrides.volume,
  };
}

describe("freezeEntryStop", () => {
  it("anchors under min(low, ema20) by half ATR", () => {
    const stop = freezeEntryStop(bar({ date: "2026-01-10", close: 100, low: 98, high: 101, open: 99 }), 99, 2);
    expect(stop).toBe(97); // min(98,99) - 1
  });
});

describe("ratchetStop", () => {
  it("raises stop to entry + 1.5% after a +6% peak", () => {
    expect(ratchetStop(100, 106, 95)).toBe(101.5);
  });

  it("leaves the initial stop in place through a +4% peak", () => {
    expect(ratchetStop(100, 104, 95)).toBe(95);
    expect(ratchetStop(100, 105.9, 95)).toBe(95);
  });
});

describe("evaluateBarExit and evaluatePositionSignal", () => {
  it("books full profit at +12%", () => {
    const exit = evaluateBarExit({
      open: 112,
      high: 113,
      low: 111,
      close: 112,
      previousClose: 110,
      ema20: 105,
      gain: 0.12,
      held: 3,
      peak: 113,
      entry: 100,
      stop: 95,
    });
    expect(exit?.action).toBe("book_full");
    expect(evaluatePositionSignal({ lastClose: 112, ema20: 105, entry: 100 }).id).toBe("book");
  });

  it("books on a red down close after +6%", () => {
    const bars = [
      bar({ date: "2026-01-09", close: 107, open: 106 }),
      bar({ date: "2026-01-10", close: 106, open: 107 }),
    ];
    const exit = evaluateBarExit({
      open: 107,
      high: 107.5,
      low: 105.5,
      close: 106,
      previousClose: 107,
      ema20: 100,
      gain: 0.06,
      held: 4,
      peak: 108,
      entry: 100,
      stop: 95,
    });
    expect(exit?.action).toBe("book_protect");
    expect(evaluatePositionSignal({ lastClose: 106, ema20: 100, entry: 100, bars }).id).toBe("book");
  });

  it("keeps a quiet green give-back open on legacy evaluateBarExit while v1.4 live signal prompts T1 50% book at +6%", () => {
    const bars = [
      bar({ date: "2026-01-09", close: 107, open: 106 }),
      bar({ date: "2026-01-10", close: 106, open: 105, volume: 100 }),
    ];
    const exit = evaluateBarExit({
      open: 105,
      high: 107,
      low: 104.5,
      close: 106,
      previousClose: 107,
      ema20: 100,
      gain: 0.06,
      held: 4,
      peak: 108,
      entry: 100,
      stop: 95,
      rvol: 0.5,
    });
    expect(exit).toBeNull();
    const live = evaluatePositionSignal({ lastClose: 106, ema20: 100, entry: 100, bars });
    expect(live.id).toBe("book");
    expect(live.label).toContain("Book 50%");
  });

  it("books a green give-back when RVOL is above 0.70", () => {
    const bars = Array.from({ length: 21 }, (_, index) => {
      const last = index === 20;
      return bar({
        date: `2026-02-${String(index + 1).padStart(2, "0")}`,
        close: last ? 106 : 107,
        open: last ? 105 : 106,
        volume: last ? 80 : 100,
      });
    });
    const exit = evaluateBarExit({
      open: 105,
      high: 107,
      low: 104.5,
      close: 106,
      previousClose: 107,
      ema20: 100,
      gain: 0.06,
      held: 4,
      peak: 108,
      entry: 100,
      stop: 95,
      rvol: 0.8,
    });
    expect(exit?.action).toBe("book_protect");
    expect(evaluatePositionSignal({ lastClose: 106, ema20: 100, entry: 100, bars }).id).toBe("book");
  });

  it("exits when a +6% close falls below EMA 20", () => {
    const signal = evaluatePositionSignal({
      lastClose: 107,
      ema20: 108,
      entry: 100,
      initialStopLoss: 95,
    });
    expect(signal.id).toBe("exit");
    expect(signal.reason).toContain("EMA 20");
  });

  it("exits when close is under EMA 20 with no 0.5% cushion", () => {
    const exit = evaluateBarExit({
      open: 100,
      high: 101,
      low: 99,
      close: 99.6,
      previousClose: 100.5,
      ema20: 100,
      gain: 0.02,
      held: 2,
      peak: 102,
      entry: 98,
      stop: 94,
    });
    expect(exit?.action).toBe("trend");
    expect(evaluatePositionSignal({ lastClose: 99.6, ema20: 100, entry: 98 }).id).toBe("exit");
  });

  it("books a close through entry +1.5% after the peak has reached +6%", () => {
    const bars = [
      bar({ date: "2026-03-02", close: 100, high: 106, low: 99, open: 100 }),
      bar({ date: "2026-03-03", close: 101.2, high: 102, low: 101, open: 102 }),
    ];
    const signal = evaluatePositionSignal({
      lastClose: 101.2,
      ema20: 100,
      entry: 100,
      initialStopLoss: 95,
      entryDate: "2026-03-02",
      bars,
    });
    expect(signal.id).toBe("book");
    expect(signal.reason).toContain("entry +1.5%");
  });

  it("exits dead money (< +2%) after 10 sessions, but lets +3% winners keep trailing EMA 20", () => {
    const deadBars = Array.from({ length: 11 }, (_, index) =>
      bar({
        date: `2026-04-${String(index + 1).padStart(2, "0")}`,
        close: 101,
        high: 102,
        low: 100,
        open: 100.5,
      }),
    );
    const deadSignal = evaluatePositionSignal({
      lastClose: 101,
      ema20: 100,
      entry: 100,
      initialStopLoss: 95,
      entryDate: "2026-04-01",
      bars: deadBars,
    });
    expect(deadSignal.id).toBe("exit");
    expect(deadSignal.label).toBe("Time");

    const winnerBars = Array.from({ length: 11 }, (_, index) =>
      bar({
        date: `2026-04-${String(index + 1).padStart(2, "0")}`,
        close: 103,
        high: 104,
        low: 102,
        open: 102.5,
      }),
    );
    const winnerSignal = evaluatePositionSignal({
      lastClose: 103,
      ema20: 100,
      entry: 100,
      initialStopLoss: 95,
      entryDate: "2026-04-01",
      bars: winnerBars,
    });
    expect(winnerSignal.id).toBe("hold");
  });

  it("hits the frozen hard stop before other rules", () => {
    const exit = evaluateBarExit({
      open: 94,
      high: 95,
      low: 93,
      close: 94,
      previousClose: 96,
      ema20: 100,
      gain: -0.06,
      held: 1,
      peak: 100,
      entry: 100,
      stop: 95,
    });
    expect(exit?.action).toBe("stop");
    expect(
      evaluatePositionSignal({ lastClose: 94, ema20: 100, entry: 100, initialStopLoss: 95 }).id,
    ).toBe("exit");
  });
});

describe("evaluateTranchePlan and evaluateTrancheBarStep (v1.4 50/50 Tranche)", () => {
  it("books T1 (50%) at +6%+ and trails T2 (50%) on EMA 20 with no +12% cap", () => {
    const plan = evaluateTranchePlan({
      entry: 100,
      quantity: 10,
      lastClose: 110,
      ema20: 105,
      bars: [bar({ date: "2026-01-09", close: 109 }), bar({ date: "2026-01-10", close: 110 })],
      initialStopLoss: 95,
    });
    expect(plan.t1.action).toBe("book");
    expect(plan.t2.action).toBe("trail");
    expect(plan.t2.detail).toContain("No +12% cap");
  });

  it("books tranche 1 on +12% and keeps tranche 2 trailing", () => {
    const plan = evaluateTranchePlan({
      entry: 100,
      quantity: 10,
      lastClose: 112,
      ema20: 105,
      initialStopLoss: 95,
    });
    expect(plan.t1.action).toBe("book");
    expect(plan.t2.action).toBe("trail");
  });

  it("executes causal T1 partial fill at +6% and rides T2 past +12% until EMA 20 breaks", () => {
    // Day hitting +6% (T1 books 50% at 106, position stays open for T2)
    const t1Step = evaluateTrancheBarStep({
      open: 104,
      high: 107,
      low: 103.5,
      close: 106.5,
      ema20: 101,
      gain: 0.065,
      held: 3,
      entry: 100,
      stop: 95,
      t1Booked: false,
    });
    expect(t1Step.t1Fill).toEqual({ price: 106, fraction: 0.5 });
    expect(t1Step.fullExit).toBeNull();

    // Day at +18% still above EMA 20 and held 14 sessions: stays open (no +12% cap, no time exit!)
    const rideStep = evaluateTrancheBarStep({
      open: 116,
      high: 119,
      low: 115,
      close: 118,
      ema20: 112,
      gain: 0.18,
      held: 14,
      entry: 100,
      stop: 101.5,
      t1Booked: true,
    });
    expect(rideStep.t1Fill).toBeNull();
    expect(rideStep.fullExit).toBeNull();

    // Dead-money exit only when held >= 10, T1 unbooked, and gain < +2%
    expect(isDeadMoneyTimeExit(10, 0.015, false)).toBe(true);
    expect(isDeadMoneyTimeExit(10, 0.025, false)).toBe(false);
    expect(isDeadMoneyTimeExit(10, 0.01, true)).toBe(false);
  });
});

describe("regime gates (v1.4 Prime-only desk)", () => {
  it("blocks unknown, red, and all Standard entries; allows Prime in amber and green", () => {
    expect(allowNewEntry("unknown", "prime")).toBe(false);
    expect(allowNewEntry("red", "prime")).toBe(false);
    expect(allowNewEntry("amber", "standard")).toBe(false);
    expect(allowNewEntry("green", "standard")).toBe(false);
    expect(allowNewEntry("amber", "prime")).toBe(true);
    expect(allowNewEntry("green", "prime")).toBe(true);
  });

  it("sizes Prime by regime and keeps Standard at 0x", () => {
    expect(riskScaleForRegime("unknown", "prime")).toBe(0);
    expect(riskScaleForRegime("red", "prime")).toBe(0);
    expect(riskScaleForRegime("amber", "prime")).toBe(0.5);
    expect(riskScaleForRegime("amber", "standard")).toBe(0);
    expect(riskScaleForRegime("green", "prime")).toBe(1);
    expect(riskScaleForRegime("green", "standard")).toBe(0);
  });

  it("cuts Green Prime to 0.5x when EMA 20 is falling", () => {
    expect(riskScaleForRegime("green", "prime", { ema20Falling: true })).toBe(0.5);
    expect(riskScaleForRegime("green", "standard", { ema20Falling: true })).toBe(0);
    expect(allowNewEntry("green", "prime")).toBe(true);
    expect(allowNewEntry("green", "standard")).toBe(false);
  });

  it("returns zero slots for unknown and red", () => {
    expect(maxSlotsForRegime("unknown")).toBe(0);
    expect(maxSlotsForRegime("red")).toBe(0);
    expect(maxSlotsForRegime("amber")).toBe(3);
    expect(maxSlotsForRegime("green")).toBe(5);
  });
});

describe("sessionsHeld", () => {
  it("counts sessions after the entry bar and warns at 10", () => {
    const bars = Array.from({ length: 12 }, (_, index) =>
      bar({ date: `2026-01-${String(index + 1).padStart(2, "0")}`, close: 100 }),
    );
    expect(sessionsHeld(bars, "2026-01-01")).toBe(11);
    expect(sessionsHeld(bars, "2026-01-03")).toBe(9);
    expect(sessionsHeld(bars, "2026-02-01")).toBeNull();
  });
});

describe("runnerStopLevel", () => {
  it("raises to max(entry, ema20) after protect gain", () => {
    expect(runnerStopLevel(100, 102, 95, PROTECT_GAIN)).toBe(102);
    expect(runnerStopLevel(100, 98, 95, PROTECT_GAIN)).toBe(100);
    expect(runnerStopLevel(100, 102, 95, FULL_PROFIT - 0.01)).toBe(102);
  });
});

describe("golden path: fill then exit", () => {
  it("next-open fill then +6% down-close books", () => {
    const entry = 100;
    const stop = freezeEntryStop(bar({ date: "2026-01-09", close: 100, low: 98, high: 101 }), 99, 2);
    expect(stop).toBe(97);

    const peak = 107;
    const ratcheted = ratchetStop(entry, peak, stop);
    expect(ratcheted).toBe(101.5);

    const exit = evaluateBarExit({
      open: 106.5,
      high: 107,
      low: 105.8,
      close: 106,
      previousClose: 107,
      ema20: 103,
      gain: 0.06,
      held: 5,
      peak,
      entry,
      stop: ratcheted,
      initialStop: stop,
    });
    expect(exit?.action).toBe("book_protect");
    expect(exit?.price).toBe(106);
  });

  it("preserves the 1.8R target using initialStop even after stop ratchets above entry", () => {
    // Entry 100, initialStop 90 -> 1R = 10 -> 1.8R target = 118 (> +12% = 112).
    // After stop ratchets to 101.5, high=114 must NOT trigger an early +12% exit.
    const held = evaluateBarExit({
      open: 111,
      high: 114,
      low: 110.5,
      close: 113,
      previousClose: 111,
      ema20: 105,
      gain: 0.13,
      held: 4,
      peak: 114,
      entry: 100,
      stop: 101.5,
      initialStop: 90,
    });
    expect(held).toBeNull();

    // Once high reaches 118, book_full triggers at 118.
    const hit = evaluateBarExit({
      open: 115,
      high: 118.5,
      low: 114.5,
      close: 117,
      previousClose: 113,
      ema20: 106,
      gain: 0.17,
      held: 5,
      peak: 118.5,
      entry: 100,
      stop: 101.5,
      initialStop: 90,
    });
    expect(hit?.action).toBe("book_full");
    expect(hit?.price).toBeCloseTo(118, 5);
  });
});

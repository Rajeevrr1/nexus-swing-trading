import { describe, expect, it } from "vitest";
import { classifyNiftyRegime, evaluateMarketRegime, EXTENSION_WARNING } from "./status";

describe("classifyNiftyRegime", () => {
  it("treats a close above both averages as Red while EMA 20 is under EMA 50", () => {
    expect(
      classifyNiftyRegime({ close: 110, ema20: 100, ema50: 105, ema20FiveSessionsAgo: 99 }).tier,
    ).toBe("red");
  });

  it("keeps the pullback between EMA 50 and EMA 20 as Amber", () => {
    expect(
      classifyNiftyRegime({ close: 100, ema20: 102, ema50: 98, ema20FiveSessionsAgo: 101 }).tier,
    ).toBe("amber");
  });

  it("stays Green when EMA 20 is falling, and flags the slope", () => {
    const reading = classifyNiftyRegime({
      close: 110,
      ema20: 105,
      ema50: 100,
      ema20FiveSessionsAgo: 106,
    });
    expect(reading.tier).toBe("green");
    expect(reading.ema20Falling).toBe(true);
  });

  it("treats a flat or rising EMA 20 as full Green structure", () => {
    const flat = classifyNiftyRegime({ close: 110, ema20: 105, ema50: 100, ema20FiveSessionsAgo: 105 });
    const rising = classifyNiftyRegime({ close: 110, ema20: 105, ema50: 100, ema20FiveSessionsAgo: 104 });
    expect(flat.ema20Falling).toBe(false);
    expect(rising.ema20Falling).toBe(false);
    expect(flat.tier).toBe("green");
  });

  it("warns above 8% and stays silent at exactly 8%", () => {
    const extended = classifyNiftyRegime({ close: 108.1, ema20: 100, ema50: 90, ema20FiveSessionsAgo: 99 });
    const exact = classifyNiftyRegime({ close: 108, ema20: 100, ema50: 90, ema20FiveSessionsAgo: 99 });
    expect(extended.extensionWarning).toBe(EXTENSION_WARNING);
    expect(extended.tier).toBe("green");
    expect(exact.extensionWarning).toBeNull();
  });

  it("does not warn outside Green", () => {
    const amber = classifyNiftyRegime({ close: 100, ema20: 110, ema50: 90, ema20FiveSessionsAgo: 100 });
    expect(amber.tier).toBe("amber");
    expect(amber.extensionWarning).toBeNull();
  });
});

describe("evaluateMarketRegime", () => {
  it("fails closed with fewer than 50 bars", () => {
    const status = evaluateMarketRegime(
      Array.from({ length: 40 }, (_, index) => ({
        date: `2026-01-${String(index + 1).padStart(2, "0")}`,
        label: "",
        open: 100,
        high: 100,
        low: 100,
        close: 100,
      })),
    );
    expect(status.tier).toBe("unknown");
    expect(status.primeRiskScale).toBe(0);
    expect(status.standardRiskScale).toBe(0);
  });

  it("is Green at 1x Prime when a flat series has a flat EMA 20", () => {
    const status = evaluateMarketRegime(
      Array.from({ length: 60 }, (_, index) => ({
        date: `2024-01-${String(index + 1).padStart(2, "0")}`,
        label: "",
        open: 100,
        high: 100,
        low: 100,
        close: 100,
      })),
    );
    expect(status.tier).toBe("green");
    expect(status.ema20Falling).toBe(false);
    expect(status.primeRiskScale).toBe(1);
    expect(status.standardRiskScale).toBe(0);
    expect(status.extensionWarning).toBeNull();
    expect(status.maxSlots).toBe(5);
  });
});

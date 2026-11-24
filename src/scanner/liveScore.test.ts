import { describe, expect, it } from "vitest";
import type { PriceBar } from "../analysis";
import { computeSectorStrengthScore } from "./liveScore";
import { resolveScanResults } from "./resolveScan";

function makeBars(start: number, step: number, count = 65): PriceBar[] {
  const base = Date.UTC(2026, 0, 1);
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(base + i * 86_400_000).toISOString().slice(0, 10);
    const close = Number((start + i * step).toFixed(2));
    return {
      date,
      label: date,
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: 200_000,
    };
  });
}

describe("peer-grouped sector strength", () => {
  it("blends excess sector return and sector breadth", () => {
    const strong = computeSectorStrengthScore(0.08, 0.02, 0.9);
    const weak = computeSectorStrengthScore(-0.04, 0.02, 0.1);
    expect(strong).not.toBeNull();
    expect(weak).not.toBeNull();
    expect(strong!).toBeGreaterThan(80);
    expect(weak!).toBeLessThan(30);
  });

  it("assigns the exact same Sector factor score to peers in the same sector", () => {
    const nifty = makeBars(20000, 15);
    // Two Pharma peers (SUNPHARMA and DIVISLAB) with very different individual returns
    const histories: Record<string, PriceBar[]> = {
      SUNPHARMA: makeBars(1000, 8), // strong individual return
      DIVISLAB: makeBars(1000, -2), // weak individual return
      TCS: makeBars(3000, 2),
      INFY: makeBars(1500, 1),
    };
    const results = resolveScanResults(histories, nifty, true);
    const sun = results.find((s) => s.symbol === "SUNPHARMA");
    const divi = results.find((s) => s.symbol === "DIVISLAB");
    const sunSector = sun?.factors.find((f) => f.key === "sector")?.value;
    const diviSector = divi?.factors.find((f) => f.key === "sector")?.value;
    expect(sunSector).toBeDefined();
    expect(diviSector).toBeDefined();
    expect(sunSector).toBe(diviSector);
  });
});

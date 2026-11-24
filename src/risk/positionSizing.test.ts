import { describe, expect, it } from "vitest";
import type { PriceBar } from "../analysis";
import {
  computePositionSizing,
  positionRiskRupees,
  scaleForSectorOverlap,
  SECTOR_OVERLAP_SCALE,
  sharesWithinRiskBudget,
} from "./positionSizing";
import { DEFAULT_RISK_SETTINGS } from "./settings";

function bars(count: number, close: number): PriceBar[] {
  return Array.from({ length: count }, (_, index) => ({
    date: `2024-03-${String(index + 1).padStart(2, "0")}`,
    label: "",
    open: close,
    high: close,
    low: close * 0.99,
    close,
    volume: 1000,
  }));
}

describe("open book cap", () => {
  it("sums open risk from the stop, or the 2.5% floor when the stop is missing", () => {
    expect(positionRiskRupees({ entry: 100, quantity: 10, stop: 90 })).toBe(100);
    expect(positionRiskRupees({ entry: 100, quantity: 10, stop: null })).toBe(25);
  });

  it("returns no shares when the leftover budget is below one share of risk", () => {
    expect(sharesWithinRiskBudget(250, 200)).toBe(0);
    expect(sharesWithinRiskBudget(250, 500)).toBe(2);
  });

  it("cuts the suggested quantity so the new trigger fits the leftover budget", () => {
    const uncapped = computePositionSizing(bars(60, 100), DEFAULT_RISK_SETTINGS, 1);
    const capped = computePositionSizing(bars(60, 100), DEFAULT_RISK_SETTINGS, 1, { remainingOpenRisk: 500 });
    expect(uncapped).not.toBeNull();
    expect(capped).not.toBeNull();
    expect(capped!.suggestedQty).toBeLessThan(uncapped!.suggestedQty);
    expect(capped!.suggestedQty * capped!.riskPerShare).toBeLessThanOrEqual(500);
  });

  it("sets quantity to 0 when the book is already at the cap", () => {
    const sized = computePositionSizing(bars(60, 100), DEFAULT_RISK_SETTINGS, 1, { remainingOpenRisk: 0 });
    expect(sized?.suggestedQty).toBe(0);
  });
});

describe("sector overlap", () => {
  it("multiplies the risk scale by 0.7 and leaves an empty sector alone", () => {
    expect(scaleForSectorOverlap(1, true)).toBeCloseTo(SECTOR_OVERLAP_SCALE);
    expect(scaleForSectorOverlap(0.5, true)).toBeCloseTo(0.35);
    expect(scaleForSectorOverlap(1, false)).toBe(1);
    expect(scaleForSectorOverlap(0, true)).toBe(0);
  });
});

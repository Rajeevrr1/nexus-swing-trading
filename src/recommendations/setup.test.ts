import { describe, expect, it } from "vitest";
import type { PriceBar } from "../analysis";
import {
  applyPrimeSectorGate,
  averageDailyTurnover,
  chaseLimits,
  evaluateSwingSetup,
  riskScaleForSetup,
  rsVersusNifty,
  sectorStrength,
} from "./setup";

function makeTrendSeries(count: number, start: number, step: number, volume = 500_000): PriceBar[] {
  const base = Date.UTC(2026, 0, 1);
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(base + i * 86_400_000).toISOString().slice(0, 10);
    const close = Number((start + i * step).toFixed(2));
    return {
      date,
      label: date,
      open: Number((close - step * 0.3).toFixed(2)),
      high: Number((close + Math.max(1, close * 0.008)).toFixed(2)),
      low: Number((close - Math.max(1, close * 0.008)).toFixed(2)),
      close,
      volume,
    };
  });
}

describe("prime sector gate", () => {
  it("keeps Prime at 55 and retries a miss as Standard", () => {
    expect(applyPrimeSectorGate("prime", 55, true)).toBe("prime");
    expect(applyPrimeSectorGate("prime", 54, true)).toBe("standard");
    expect(applyPrimeSectorGate("prime", null, true)).toBe("standard");
    expect(applyPrimeSectorGate("prime", 40, false)).toBeNull();
  });

  it("does not rewrite Standard or an empty tier", () => {
    expect(applyPrimeSectorGate("standard", 20, false)).toBe("standard");
    expect(applyPrimeSectorGate(null, 90, true)).toBeNull();
  });

  it("reads the sector factor from the scan", () => {
    expect(sectorStrength({ factors: [{ key: "sector", value: 61 }] })).toBe(61);
    expect(sectorStrength({ factors: [{ key: "trueRs", value: 80 }] })).toBeNull();
  });
});

describe("trigger risk scale", () => {
  it("sizes Prime by regime and pauses Standard (0×) on the v1.4 Prime-only desk", () => {
    expect(riskScaleForSetup("amber", "standard", false)).toBe(0);
    expect(riskScaleForSetup("amber", "prime", false)).toBe(0.5);
    expect(riskScaleForSetup("green", "standard", false)).toBe(0);
    expect(riskScaleForSetup("green", "prime", false)).toBe(1);
    expect(riskScaleForSetup("green", "prime", true)).toBe(0.5);
  });
});

describe("chaseLimits and turnover math", () => {
  it("handles null or invalid stop cleanly without divide-by-0.01 distortion", () => {
    const limits = chaseLimits(1000, null, 20);
    expect(limits.riskRewardTo12Pct).toBeNull();
    expect(limits.maxChasePrice).toBeCloseTo(1007, 2); // min(1000 + 0.35*20 = 1007, 1012)
    expect(limits.targetPrice).toBeCloseTo(1120, 2);
  });

  it("computes average daily turnover using typical price (H+L+C)/3", () => {
    const bars = Array.from({ length: 20 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      label: `2026-01-${String(i + 1).padStart(2, "0")}`,
      open: 100,
      high: 120,
      low: 90,
      close: 90,
      volume: 10_000,
    }));
    // Typical price = (120 + 90 + 90) / 3 = 100, turnover = 100 * 10,000 = 1,000,000
    expect(averageDailyTurnover(bars)).toBeCloseTo(1_000_000, 2);
  });
});

describe("rsVersusNifty date alignment and compounded ratio", () => {
  it("uses date-aligned compounded ratio RS = (1 + r_stock) / (1 + r_nifty) - 1", () => {
    const stock = makeTrendSeries(60, 100, 1.5);
    const nifty = makeTrendSeries(60, 20000, 50);
    // Add an extra newer date to nifty only: stock's end date must still align to nifty's matching date.
    nifty.push({
      date: "2026-03-02",
      label: "2026-03-02",
      open: 23000,
      high: 23100,
      low: 22900,
      close: 23050,
      volume: 1,
    });
    const endStock = stock[59].close;
    const baseStock = stock[39].close;
    const endNifty = nifty[59].close;
    const baseNifty = nifty[39].close;
    const expected = (endStock / baseStock) / (endNifty / baseNifty) - 1;
    expect(rsVersusNifty(stock, nifty)).toBeCloseTo(expected, 6);
  });
});

describe("gap guard on red pullbacks vs live quote", () => {
  it("does not reject a normal red pullback bar, but rejects when livePrice exceeds maxChasePrice", () => {
    const nifty = makeTrendSeries(70, 20000, 10, 1);
    // Build a realistic oscillating young uptrend so Wilder RSI sits inside 53..70,
    // EMA20 stays within 2.5% above EMA50, and 20-session RS beats Nifty by > +4%.
    const bars: PriceBar[] = [];
    const base = Date.UTC(2026, 0, 1);
    const pattern = [9, -4, 10, -5, 11, -4, 9, -5, 10, -4];
    let price = 1000;
    for (let i = 0; i < 69; i += 1) {
      const date = new Date(base + i * 86_400_000).toISOString().slice(0, 10);
      if (i >= 48) {
        price = Number((price + pattern[(i - 48) % pattern.length]).toFixed(2));
      } else {
        price = Number((1000 + (i % 2 === 0 ? 2 : -2)).toFixed(2));
      }
      bars.push({
        date,
        label: date,
        open: Number((price - 2).toFixed(2)),
        high: Number((price + 8).toFixed(2)),
        low: Number((price - 8).toFixed(2)),
        close: price,
        volume: 300_000,
      });
    }
    // Last bar: healthy red pullback candle whose open is +1.5% above close (> 1.2% chase cap),
    // CLV >= 0.28 (not capitulation), dipping into the EMA20 zone and closing above EMA20.
    const lastDate = new Date(base + 69 * 86_400_000).toISOString().slice(0, 10);
    const prevClose = bars[68].close;
    const pullbackClose = Number((prevClose - 12).toFixed(2));
    const pullbackOpen = Number((pullbackClose * 1.015).toFixed(2));
    bars.push({
      date: lastDate,
      label: lastDate,
      open: pullbackOpen,
      high: Number((pullbackOpen + 1).toFixed(2)),
      low: Number((pullbackClose - 8).toFixed(2)),
      close: pullbackClose,
      volume: 270_000,
    });

    const eod = evaluateSwingSetup(bars, nifty, 75);
    expect(eod.triggerTier).not.toBeNull();
    expect(eod.pullbackSwing).toBe(true);

    const gapped = evaluateSwingSetup(bars, nifty, 75, undefined, {
      livePrice: (eod.maxChasePrice ?? pullbackClose) + 15,
    });
    expect(gapped.pullbackSwing).toBe(false);
    expect(gapped.actionBucket).toBe("gtt");
    expect(gapped.triggerHint).toContain("above max chase");
  });
});

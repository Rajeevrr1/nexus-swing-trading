import { describe, expect, it } from "vitest";
import type { PriceBar } from "./index";
import { atrWilder, relativeVolumeAt } from "./indicators";
import { effectivePullbackBand, wilderRsi } from "../strategy/pullback";

function bar(date: string, open: number, high: number, low: number, close: number, volume = 1000): PriceBar {
  return { date, label: date, open, high, low, close, volume };
}

describe("atrWilder", () => {
  it("seeds from i=1..period including overnight gaps and leaves index < period null", () => {
    // Bar 0 closes at 100; bar 1 gaps up to 120 (range=2, gap TR = |121-100| = 21); bars 2..14 have TR=2.
    const bars: PriceBar[] = [bar("2026-01-01", 99, 101, 99, 100)];
    bars.push(bar("2026-01-02", 120, 121, 119, 120));
    for (let i = 2; i <= 15; i += 1) {
      bars.push(bar(`2026-01-${String(i + 1).padStart(2, "0")}`, 120, 121, 119, 120));
    }
    const atr = atrWilder(bars, 14);
    expect(atr[13]).toBeNull();
    // Mean of [21, 2, 2, ..., 2] (14 terms: one 21 and thirteen 2s) = 47 / 14
    expect(atr[14]).toBeCloseTo(47 / 14, 6);
    // Next Wilder step: (atr[14] * 13 + 2) / 14
    expect(atr[15]).toBeCloseTo(((47 / 14) * 13 + 2) / 14, 6);
  });
});

describe("relativeVolumeAt", () => {
  it("uses a trimmed mean so a single 15x block-deal spike does not distort RVOL", () => {
    const bars: PriceBar[] = Array.from({ length: 21 }, (_, i) =>
      bar(`2026-01-${String(i + 1).padStart(2, "0")}`, 100, 101, 99, 100, i === 5 ? 15_000 : 1_000),
    );
    // All 18 trimmed prior bars have volume 1000, today has 1000 -> RVOL should be exactly 1.0
    expect(relativeVolumeAt(bars, 20, 20)).toBeCloseTo(1.0, 6);
  });
});

describe("wilderRsi and effectivePullbackBand", () => {
  it("returns 50 (neutral) instead of 100 on completely flat price series", () => {
    const flat = Array.from({ length: 20 }, () => 100);
    const rsi = wilderRsi(flat, 14);
    expect(rsi[14]).toBe(50);
    expect(rsi[19]).toBe(50);
  });

  it("scales pullback proximity band with ATR% clamped between 1.5% and 3.5%", () => {
    // Low vol: ATR 0.5% -> 1.5 * 0.5% = 0.75% -> clamped to 1.5%
    expect(effectivePullbackBand(100, 0.5)).toBeCloseTo(0.015, 6);
    // Mid vol: ATR 1.6% -> 1.5 * 1.6% = 2.4%
    expect(effectivePullbackBand(100, 1.6)).toBeCloseTo(0.024, 6);
    // High vol: ATR 4.0% -> 1.5 * 4.0% = 6.0% -> clamped to 3.5%
    expect(effectivePullbackBand(100, 4.0)).toBeCloseTo(0.035, 6);
  });
});

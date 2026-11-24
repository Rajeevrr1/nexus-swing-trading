import { describe, expect, it } from "vitest";
import type { PriceBar } from "../analysis";
import { evaluatePortfolioTechnicals } from "./technicals";
import { pruneTradeBook, resolveFrozenStop, type TradeBookEntry } from "./tradeBook";

function makeSeries(closes: number[]): PriceBar[] {
  const base = Date.UTC(2026, 0, 1);
  return closes.map((close, i) => {
    const date = new Date(base + i * 86_400_000).toISOString().slice(0, 10);
    return {
      date,
      label: date,
      open: close,
      high: close + 2,
      low: close - 2,
      close,
      volume: 100_000,
    };
  });
}

describe("tradeBook stop anchoring and pruning", () => {
  it("anchors computed initialStop strictly under entryPrice even when current close is much higher", () => {
    const bars = makeSeries(Array.from({ length: 60 }, (_, i) => 100 + i * 2)); // last close = 218
    const result = resolveFrozenStop({
      symbol: "INFY",
      source: "kite",
      entryPrice: 150,
      quantity: 10,
      bars,
    });
    expect(result.stop).not.toBeNull();
    expect(result.stop!).toBeLessThan(150);
    expect(result.stop!).toBeLessThanOrEqual(150 * 0.975);
    expect(result.upsert?.initialStop).toBe(result.stop);
  });

  it("syncs stored entryPrice and keeps stop below new cost basis when position changes", () => {
    const existing: TradeBookEntry = {
      symbol: "INFY",
      source: "kite",
      entryDate: "2026-01-10",
      entryPrice: 1500,
      initialStop: 1450,
      quantity: 10,
    };
    const averaged = resolveFrozenStop({
      symbol: "INFY",
      source: "kite",
      entryPrice: 1440, // averaged down below prior stop 1450!
      quantity: 20,
      existing,
    });
    expect(averaged.stop).not.toBeNull();
    expect(averaged.stop!).toBeLessThan(1440);
    expect(averaged.upsert?.quantity).toBe(20);
    expect(averaged.upsert?.entryPrice).toBe(1440);
  });

  it("auto-marks t1Booked when Kite holding quantity drops at the same cost basis so T1 is not double-prompted", () => {
    const existing: TradeBookEntry = {
      symbol: "INFY",
      source: "kite",
      entryDate: "2026-01-10",
      entryPrice: 1500,
      initialStop: 1450,
      quantity: 10,
    };
    const afterT1Sell = resolveFrozenStop({
      symbol: "INFY",
      source: "kite",
      entryPrice: 1500,
      quantity: 5, // user sold 50% (T1) in Zerodha
      existing,
    });
    expect(afterT1Sell.upsert?.t1Booked).toBe(true);
    expect(afterT1Sell.upsert?.quantity).toBe(5);

    const analysis = evaluatePortfolioTechnicals({
      symbol: "INFY",
      entry: 1500,
      quantity: 5,
      lastClose: 1620, // +8% open gain
      ema20: 1560,
      initialStopLoss: 1450,
      t1Booked: true,
    });
    // Must HOLD runner, NOT prompt TRIM / Book 50% a second time!
    expect(analysis.verdict).toBe("HOLD");
  });

  it("preserves Kite stop entries when pruneKite is false (disconnect/loading)", () => {
    const book: TradeBookEntry[] = [
      {
        symbol: "INFY",
        source: "kite",
        entryPrice: 1500,
        entryDate: "2026-01-10",
        initialStop: 1440,
        quantity: 10,
      },
      {
        symbol: "TCS",
        source: "added",
        entryPrice: 3500,
        entryDate: "2026-01-10",
        initialStop: 3350,
        quantity: 5,
      },
    ];
    const kept = pruneTradeBook(book, new Set(), { pruneKite: false, pruneAdded: false });
    expect(kept).toHaveLength(2);
    expect(kept.map((e) => e.symbol)).toEqual(["INFY", "TCS"]);

    const prunedAddedOnly = pruneTradeBook(book, new Set(), { pruneKite: false, pruneAdded: true });
    expect(prunedAddedOnly.map((e) => e.symbol)).toEqual(["INFY"]);
  });
});

describe("evaluatePortfolioTechnicals", () => {
  it("never recommends AVERAGE in a downtrend (EMA20 < EMA50) and sorts bars chronologically", () => {
    // Falling trend: 200 down to 141 -> EMA20 < EMA50
    const descending = makeSeries(Array.from({ length: 60 }, (_, i) => 200 - i));
    const reversed = [...descending].reverse();
    const analysis = evaluatePortfolioTechnicals({
      symbol: "TEST",
      entry: 145,
      quantity: 10,
      lastClose: 141,
      ema20: 140,
      bars: reversed,
      initialStopLoss: 135,
    });
    expect(analysis.verdict).not.toBe("AVERAGE");
    expect(analysis.favorableToAverage).toBe(false);
  });

  it("uses 1.8R dynamic target when initialStopLoss implies > +12%", () => {
    const uptrend = makeSeries(Array.from({ length: 60 }, (_, i) => 100 + i * 0.5));
    const analysis = evaluatePortfolioTechnicals({
      symbol: "TEST",
      entry: 100,
      quantity: 10,
      lastClose: 105,
      ema20: 103,
      bars: uptrend,
      initialStopLoss: 90, // 1R = 10 -> 1.8R = 118 (> 112)
    });
    expect(analysis.targetLevel).toBeCloseTo(118, 2);
  });
});

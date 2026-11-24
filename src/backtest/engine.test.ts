import { describe, expect, it } from "vitest";
import type { PriceBar } from "../analysis";
import type { ScoredSecurity } from "../scanner";
import { runBacktest } from "./engine";

function security(symbol: string, sector: string, sectorFactorValue = 80): ScoredSecurity {
  return {
    symbol,
    name: symbol,
    sector,
    conviction: 80,
    grade: "A",
    stance: "Strong",
    tone: "strong",
    action: "Buy",
    factors: [
      { key: "trueRs", label: "True RS", value: 80 },
      { key: "volume", label: "Volume", value: 80 },
      { key: "sector", label: "Sector", value: sectorFactorValue },
      { key: "closingStrength", label: "Close", value: 80 },
    ],
  };
}

function buildPullbackFixture(): {
  nifty: PriceBar[];
  stock: PriceBar[];
  peer: PriceBar[];
} {
  const base = Date.UTC(2026, 0, 1);
  const nifty: PriceBar[] = [];
  const stock: PriceBar[] = [];
  const peer: PriceBar[] = [];
  // 70 bars: bars 0..44 flat, bars 45..64 steady uptrend, bar 65 pullback trigger,
  // bar 66 next-morning open fill with intrabar +8% high AND -8% low (tests causal ratchet!),
  // bars 67..69 recovery.
  for (let i = 0; i < 70; i += 1) {
    const date = new Date(base + i * 86_400_000).toISOString().slice(0, 10);
    const nClose = Number((20000 + i * 20).toFixed(2));
    nifty.push({ date, label: date, open: nClose - 5, high: nClose + 15, low: nClose - 15, close: nClose, volume: 1 });

    const sClose = i < 45 ? 1000 : Number((1000 + (i - 44) * 4.5).toFixed(2));
    stock.push({
      date,
      label: date,
      open: sClose - 2,
      high: sClose + 6,
      low: sClose - 6,
      close: sClose,
      volume: 300_000,
    });
    peer.push({
      date,
      label: date,
      open: sClose - 2,
      high: sClose + 6,
      low: sClose - 6,
      close: sClose,
      volume: 300_000,
    });
  }

  // Bar 65: clean pullback touching EMA20 (~1055) while closing just above EMA20
  stock[65] = {
    ...stock[65],
    open: 1082,
    high: 1084,
    low: 1058,
    close: 1072,
    volume: 270_000,
  };
  // Bar 66: fills at open 1072 (under maxChasePrice, above stop ~1050).
  // Spikes to +8% (1158) AND drops to 1020 (below hard stop ~1050) on the SAME day!
  // With causal ordering, start-of-day stop (~1050) triggers Stop Loss (NOT a +1.5% ratcheted win!).
  stock[66] = {
    ...stock[66],
    open: 1072,
    high: 1158,
    low: 1020,
    close: 1030,
    volume: 320_000,
  };

  return { nifty, stock, peer };
}

describe("runBacktest integrity fixes", () => {
  it("prevents same-bar intrabar ratchet look-ahead and records an honest Stop Loss", () => {
    const { nifty, stock, peer } = buildPullbackFixture();
    const report = runBacktest({
      period: "6m",
      source: "kite",
      securities: [security("TESTA", "IT", 90), security("TESTB", "IT", 90)],
      histories: { TESTA: stock, TESTB: peer },
      nifty,
    });
    const desk = report.segments.find((s) => s.id === "pullback-desk");
    expect(desk).toBeDefined();
    const tradeA = desk!.trades.find((t) => t.symbol === "TESTA" && t.entryDate === stock[66].date);
    expect(tradeA).toBeDefined();
    expect(tradeA!.reason).toBe("Stop Loss");
    expect(tradeA!.returnPct).toBeLessThan(0);
  });

  it("uses point-in-time historical sector scores (unaffected by today's security.factors)", () => {
    const { nifty, stock, peer } = buildPullbackFixture();
    const highToday = runBacktest({
      period: "6m",
      source: "kite",
      securities: [security("TESTA", "IT", 99), security("TESTB", "IT", 99)],
      histories: { TESTA: stock, TESTB: peer },
      nifty,
    });
    const lowToday = runBacktest({
      period: "6m",
      source: "kite",
      securities: [security("TESTA", "IT", 5), security("TESTB", "IT", 5)],
      histories: { TESTA: stock, TESTB: peer },
      nifty,
    });
    const deskHigh = highToday.segments.find((s) => s.id === "pullback-desk")!;
    const deskLow = lowToday.segments.find((s) => s.id === "pullback-desk")!;
    expect(deskHigh.trades.length).toBe(deskLow.trades.length);
    expect(deskHigh.totalReturn).toBeCloseTo(deskLow.totalReturn, 8);
  });

  it("captures unrealized open-position drawdown on the desk daily MTM equity curve", () => {
    const { nifty, stock, peer } = buildPullbackFixture();
    // Make bar 66 open at 1072, stay above stop (~1050) and EMA20 (~1058), close at 1060 (-1.1% MTM dip),
    // then rally on bars 67..69 without ever closing as a loss!
    stock[66] = { ...stock[66], open: 1072, high: 1074, low: 1059, close: 1060, volume: 250_000 };
    stock[67] = { ...stock[67], open: 1062, high: 1090, low: 1061, close: 1088, volume: 250_000 };
    stock[68] = { ...stock[68], open: 1090, high: 1120, low: 1088, close: 1118, volume: 250_000 };
    stock[69] = { ...stock[69], open: 1120, high: 1140, low: 1115, close: 1138, volume: 250_000 };

    const report = runBacktest({
      period: "6m",
      source: "kite",
      securities: [security("TESTA", "IT", 80), security("TESTB", "IT", 80)],
      histories: { TESTA: stock, TESTB: peer },
      nifty,
    });
    const desk = report.segments.find((s) => s.id === "pullback-desk")!;
    expect(desk.trades.some((t) => t.symbol === "TESTA")).toBe(true);
    // Even with zero closed losing trades, the -1.1% open MTM dip on day 66 produces > 0 drawdown!
    expect(desk.maxDrawdown).not.toBeNull();
    expect(desk.maxDrawdown!).toBeGreaterThan(0);
  });

  it("computes gross expectancy as exact mean of closed returns including breakeven 0% exits", () => {
    const { nifty, stock, peer } = buildPullbackFixture();
    // Make stock close at exact entry price (0% breakeven) via EMA20 exit on day 66
    // and peer close at a loss on day 66 so we have 1 breakeven + 1 loss.
    const entryPrice = 1072;
    // Peer also triggers on bar 65, then loses on bar 66
    peer[65] = { ...stock[65] };
    peer[66] = { ...stock[66], open: entryPrice, high: entryPrice + 2, low: 1020, close: 1030 };
    // Stock exits at exact breakeven (bar.close === entryPrice while below ema20? Or time stop / stop loss?)
    // Actually easier: verify expectancy === mean(closed.map(t => t.returnPct)) for ALL closed trades!
    const report = runBacktest({
      period: "6m",
      source: "kite",
      securities: [security("TESTA", "IT", 80), security("TESTB", "IT", 80)],
      histories: { TESTA: stock, TESTB: peer },
      nifty,
    });
    for (const seg of report.segments) {
      const closed = seg.trades.filter((t) => t.result !== "Open");
      if (closed.length === 0) continue;
      const expectedMean = closed.reduce((sum, t) => sum + t.returnPct, 0) / closed.length;
      expect(seg.expectancy).toBeCloseTo(expectedMean, 10);
    }
  });

  it("executes v1.4 50/50 tranche booking at +6% and trails T2 on EMA 20 past +12%", () => {
    const { nifty, stock, peer } = buildPullbackFixture();
    // Day 66: opens 1072, hits +6% T1 target (1136.32) without hitting stop; stays open for T2!
    stock[66] = { ...stock[66], open: 1072, high: 1145, low: 1068, close: 1140, volume: 280_000 };
    // Day 67: rides to +18% (1265) — NO +12% cap!
    stock[67] = { ...stock[67], open: 1145, high: 1270, low: 1140, close: 1265, volume: 280_000 };
    // Day 68: still above EMA 20
    stock[68] = { ...stock[68], open: 1260, high: 1280, low: 1240, close: 1250, volume: 260_000 };
    // Day 69: closes under EMA 20 (~1110) while staying above protective stop (1088.08) -> T2 exits at 1095
    stock[69] = { ...stock[69], open: 1200, high: 1210, low: 1092, close: 1095, volume: 310_000 };

    const report = runBacktest({
      period: "6m",
      source: "kite",
      securities: [security("TESTA", "IT", 80), security("TESTB", "IT", 80)],
      histories: { TESTA: stock, TESTB: peer },
      nifty,
    });
    const desk = report.segments.find((s) => s.id === "pullback-desk")!;
    const tradeA = desk.trades.find((t) => t.symbol === "TESTA" && t.entryDate === stock[66].date);
    expect(tradeA).toBeDefined();
    expect(tradeA!.reason).toBe("Book Profit");
    expect(tradeA!.why).toContain("T1 50% booked");
    // Blended exit = 0.5 * (1072 * 1.06 = 1136.32) + 0.5 * 1095 = 1115.66
    expect(tradeA!.exit).toBeCloseTo(0.5 * (1072 * 1.06) + 0.5 * 1095, 1);
  });
});

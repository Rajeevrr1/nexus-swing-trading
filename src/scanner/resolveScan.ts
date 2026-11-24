import { buildAnalysis, latestEma, type PriceBar } from "../analysis";
import { sessionReturnAt } from "../analysis/indicators";
import { scoreSecurity } from "./score";
import { computeSectorStrengthScore, scoreSecurityFromBars } from "./liveScore";
import type { ScoredSecurity } from "./types";
import { getUniverse } from "./universe";

/** Score the full universe from live (or sample) OHLCV with true peer-grouped sector strength. */
export function resolveScanResults(
  histories: Record<string, PriceBar[]>,
  nifty: readonly PriceBar[],
  preferLive: boolean,
): ScoredSecurity[] {
  const universe = getUniverse();
  const barsBySymbol = new Map<string, PriceBar[]>();
  const returns: number[] = [];
  const sectorReturns = new Map<string, number[]>();
  const sectorAboveEma = new Map<string, { above: number; total: number }>();

  for (const security of universe) {
    const raw =
      preferLive && histories[security.symbol]?.length >= 50
        ? histories[security.symbol]
        : buildAnalysis(scoreSecurity(security)).bars;
    const bars = [...raw].sort((a, b) => a.date.localeCompare(b.date));
    barsBySymbol.set(security.symbol, bars);
    const index = bars.length - 1;
    const closes = bars.map((bar) => bar.close);
    const value = sessionReturnAt(closes, index, 20);
    if (value != null) {
      returns.push(value);
      const list = sectorReturns.get(security.sector) ?? [];
      list.push(value);
      sectorReturns.set(security.sector, list);
    }
    const ema20 = latestEma(closes, 20);
    const lastClose = closes[index];
    if (ema20 != null && lastClose != null) {
      const counts = sectorAboveEma.get(security.sector) ?? { above: 0, total: 0 };
      counts.total += 1;
      if (lastClose >= ema20) counts.above += 1;
      sectorAboveEma.set(security.sector, counts);
    }
  }

  const universeAverageReturn =
    returns.length > 0 ? returns.reduce((sum, value) => sum + value, 0) / returns.length : null;

  const sectorPeerScores = new Map<string, number | null>();
  for (const [sector, list] of sectorReturns) {
    const avg = list.length > 0 ? list.reduce((sum, v) => sum + v, 0) / list.length : null;
    const breadthCounts = sectorAboveEma.get(sector);
    const breadth = breadthCounts && breadthCounts.total > 0 ? breadthCounts.above / breadthCounts.total : null;
    sectorPeerScores.set(sector, computeSectorStrengthScore(avg, universeAverageReturn, breadth));
  }

  return universe
    .map((security) => {
      const bars = barsBySymbol.get(security.symbol) ?? buildAnalysis(scoreSecurity(security)).bars;
      const peerScore = sectorPeerScores.get(security.sector) ?? null;
      return scoreSecurityFromBars(security, bars, nifty, universeAverageReturn, peerScore);
    })
    .sort((a, b) => b.conviction - a.conviction || a.symbol.localeCompare(b.symbol));
}

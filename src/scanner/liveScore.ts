import type { PriceBar } from "../analysis";
import {
  closeLocationValue,
  emaTrendScore,
  relativeVolumeAt,
  sessionReturnAt,
} from "../analysis/indicators";
import { rsVersusNifty } from "../recommendations/setup";
import {
  actionForScore,
  FACTOR_LABELS,
  gradeForScore,
  normalizeFactors,
  scoreFactors,
  stanceForScore,
  toneForScore,
} from "./score";
import type { FactorInput, FactorReading, ScoredSecurity, Security } from "./types";

const FACTOR_ORDER = ["trueRs", "volume", "sector", "closingStrength"] as const;

function clamp100(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function mapRsEdge(edge: number | null): number {
  if (edge == null) return 45;
  if (edge >= 0.03 && edge < 0.08) return 90;
  if (edge >= 0.08 && edge < 0.14) return 82;
  if (edge >= 0.14) return 72;
  return clamp100(30 + (Math.max(edge, 0) / 0.03) * 45);
}

function mapRvol(rvol: number | null, bar: PriceBar): number {
  if (rvol == null) return 55;
  const clv = closeLocationValue(bar);
  const bullishBounce = bar.close >= bar.open && clv >= 0.55;
  if (rvol <= 0.85) return 90;
  if (bullishBounce && rvol >= 1.1) return 86;
  if (rvol <= 1.15) return 74;
  if (bullishBounce) return 68;
  if (rvol < 1.5) return 45;
  return 30;
}

function mapUniverseSector(relativeReturn: number | null): number {
  if (relativeReturn == null) return 50;
  const normalized = (relativeReturn + 0.05) / 0.15;
  return clamp100(normalized * 100);
}

/**
 * True peer-based sector strength (0–100): blends sector excess 20d return vs the universe
 * (centered at 55 for 0% excess, ±8% spanning 10..100) with sector breadth (% above EMA 20).
 */
export function computeSectorStrengthScore(
  sectorAvgReturn: number | null,
  universeReturn: number | null,
  sectorBreadth: number | null,
): number | null {
  if (sectorAvgReturn == null || universeReturn == null) return null;
  const excess = sectorAvgReturn - universeReturn;
  const returnScore = clamp100(55 + (excess / 0.08) * 45);
  if (sectorBreadth == null) return returnScore;
  const breadthScore = clamp100(sectorBreadth * 100);
  return clamp100(returnScore * 0.65 + breadthScore * 0.35);
}

/** Live OHLCV factor inputs. Uses true peer sector strength when supplied by the scan resolver. */
export function liveFactorInput(
  bars: readonly PriceBar[],
  nifty: readonly PriceBar[],
  universeReturn?: number | null,
  sectorPeerScore?: number | null,
): FactorInput | null {
  const series = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  const index = series.length - 1;
  if (index < 50) return null;
  const closes = series.map((bar) => bar.close);
  const edge = rsVersusNifty(series, nifty);
  const rvol = relativeVolumeAt(series, index);
  const clv = closeLocationValue(series[index]);
  const trend = emaTrendScore(closes);
  const ownReturn = sessionReturnAt(closes, index, 20);
  const fallbackSector =
    universeReturn != null && ownReturn != null ? mapUniverseSector(ownReturn - universeReturn) : trend ?? 50;
  const sector =
    sectorPeerScore != null
      ? clamp100(sectorPeerScore)
      : trend != null
        ? Math.round((fallbackSector + trend) / 2)
        : fallbackSector;
  return {
    trueRs: mapRsEdge(edge),
    volume: mapRvol(rvol, series[index]),
    sector,
    closingStrength: clamp100(clv * 100),
  };
}

/** Conviction from bars up to `index`, so a backtest filter does not use a future session. */
export function convictionAt(
  bars: readonly PriceBar[],
  nifty: readonly PriceBar[],
  index: number,
  universeReturn?: number | null,
  sectorPeerScore?: number | null,
): number | null {
  if (index < 50) return null;
  const slice = bars.slice(0, index + 1);
  const asOf = slice.at(-1)?.date;
  const niftySlice = asOf ? nifty.filter((bar) => bar.date <= asOf) : nifty;
  const input = liveFactorInput(slice, niftySlice, universeReturn, sectorPeerScore);
  if (!input) return null;
  return scoreFactors(input);
}

export function scoreSecurityFromBars(
  security: Security,
  bars: readonly PriceBar[],
  nifty: readonly PriceBar[],
  universeAverageReturn?: number | null,
  sectorPeerScore?: number | null,
): ScoredSecurity {
  const input = liveFactorInput(bars, nifty, universeAverageReturn, sectorPeerScore) ?? security.factors;
  const normalized = normalizeFactors(input);
  const factorReadings: FactorReading[] = FACTOR_ORDER.map((key) => ({
    key,
    label: FACTOR_LABELS[key],
    value: normalized[key],
  }));
  const conviction = scoreFactors(normalized);
  return {
    symbol: security.symbol,
    name: security.name,
    sector: security.sector,
    factors: factorReadings,
    conviction,
    grade: gradeForScore(conviction),
    stance: stanceForScore(conviction),
    tone: toneForScore(conviction),
    action: actionForScore(conviction),
  };
}


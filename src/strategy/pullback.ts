import type { PriceBar } from "../analysis";
import { closeLocationValue } from "../analysis/indicators";
export const PULLBACK_BAND = 0.035;
export const RS_EDGE = 0.03;
/** Shared weak-volume floor. Standard keeps this. Prime uses PRIME_RVOL_FLOOR. */
export const RVOL_FLOOR = 0.45;
/** Prime requires a firmer relative-volume print than the shared weak-volume gate. */
export const PRIME_RVOL_FLOOR = 0.6;
export const RSI_EXTENDED = 75;
/** Prime RSI window. 48–52 still needs RVOL or RS confirmation. */
export const PRIME_RSI_MIN = 48;
export const PRIME_RSI_MAX = 72;
export const PRIME_RSI_CONFIRM_MAX = 52;
export const PRIME_RSI_CONFIRM_RVOL = 0.75;
export const PRIME_RSI_CONFIRM_RS = 0.04;
export const FIVE_DAY_EXTENDED = 0.1;
/** Skip both tiers when ATR(14) is more than 6% of price. */
export const MAX_ATR_PERCENT = 0.06;
/** Prime sector-strength floor. Below this, the name may still qualify as Standard. */
export const PRIME_SECTOR_MIN = 55;
/** Standard needs two of the four continuation traits. Three was worse in the 3.5y book. */
export const STANDARD_TRAIT_MIN = 2;

/**
 * Volatility-adaptive pullback proximity band: scales with 1.5 × ATR%
 * clamped between 1.5% (defensive low-vol names) and `maxBand` (3.5%).
 */
export function effectivePullbackBand(close: number, atr14: number | null | undefined, maxBand = PULLBACK_BAND): number {
  if (atr14 == null || !(atr14 > 0) || !(close > 0)) return maxBand;
  const atrPct = atr14 / close;
  return Math.min(maxBand, Math.max(0.015, 1.5 * atrPct));
}

export function taggedPullbackGeometry(
  bars: readonly PriceBar[],
  ema20: readonly (number | null)[],
  ema50: readonly (number | null)[],
  index: number,
  band = PULLBACK_BAND,
  atr14?: number | null,
): boolean {
  if (index < 21) return false;
  const bar = bars[index];
  const fast = ema20[index];
  const slow = ema50[index];
  const previousFast = ema20[index - 1];
  const previousClose = bars[index - 1].close;
  if (fast == null || slow == null || previousFast == null) return false;
  const adaptiveBand = effectivePullbackBand(bar.close, atr14, band);
  const uptrend = fast > slow && bar.close > slow;
  const alreadyTrending = previousClose > previousFast;
  const nearAverage = bar.low <= fast * (1 + adaptiveBand) && bar.close >= fast;
  let priorHigh = bars[index - 20].close;
  for (let k = index - 19; k < index; k += 1) priorHigh = Math.max(priorHigh, bars[k].close);
  return uptrend && alreadyTrending && nearAverage && bar.close <= priorHigh;
}

/** Allows a flat or rising EMA 20. Blocks only an actively falling average. */
export function emaNotFalling(ema20: readonly (number | null)[], index: number, lookback = 5): boolean {
  const today = ema20[index];
  const prior = ema20[index - lookback];
  return today != null && prior != null && today >= prior * 0.998;
}

/** Wide-range bearish close in the bottom quarter — the only candle shape v1.3 rejects. */
export function isCapitulationCandle(bar: PriceBar, atr14: number | null): boolean {
  if (atr14 == null || atr14 <= 0) return false;
  const clv = closeLocationValue(bar);
  const range = bar.high - bar.low;
  return bar.close < bar.open && clv < 0.25 && range > 1.25 * atr14;
}

export function wilderRsi(closes: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  const value = () =>
    avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss);
  out[period] = value();
  for (let i = period + 1; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    out[i] = value();
  }
  return out;
}

export function isExtendedMove(
  closes: readonly number[],
  index: number,
  precomputedRsi?: number | null,
): boolean {
  const rsi = precomputedRsi !== undefined ? precomputedRsi : wilderRsi(closes, 14)[index];
  const base = closes[index - 5];
  const fiveDay = base > 0 ? closes[index] / base - 1 : null;
  return (rsi != null && rsi > RSI_EXTENDED) || (fiveDay != null && fiveDay > FIVE_DAY_EXTENDED);
}

export interface PullbackEntryOptions {
  version: "v1.2" | "v1.3";
  rsEdge?: number;
  checkVolume?: boolean;
  atr14?: number | null;
  /** Used by the Prime RSI confirmation band (48–52). */
  rvol?: number | null;
  /** Precomputed Wilder RSI(14) at `index` to avoid O(N²) recomputation in backtests. */
  rsi?: number | null;
}

export function pullbackEntryPasses(
  bars: readonly PriceBar[],
  ema20: readonly (number | null)[],
  ema50: readonly (number | null)[],
  index: number,
  relativeStrength: number | null,
  volumeOk: boolean,
  options: PullbackEntryOptions,
): boolean {
  if (!taggedPullbackGeometry(bars, ema20, ema50, index, PULLBACK_BAND, options.atr14)) return false;
  const edge = options.rsEdge ?? RS_EDGE;
  if (relativeStrength == null || relativeStrength < edge) return false;
  const closes = options.rsi !== undefined ? null : bars.map((bar) => bar.close);
  const rsiNow = options.rsi !== undefined ? options.rsi : wilderRsi(closes!, 14)[index];
  const base = bars[index - 5]?.close;
  const fiveDay = base != null && base > 0 ? bars[index].close / base - 1 : null;
  const extended = (rsiNow != null && rsiNow > RSI_EXTENDED) || (fiveDay != null && fiveDay > FIVE_DAY_EXTENDED);
  if (extended) return false;
  if (options.checkVolume && !volumeOk) return false;
  if (options.version === "v1.2") return true;
  const fast = ema20[index];
  const slow = ema50[index];
  const bar = bars[index];
  if (fast == null || slow == null || fast <= 0 || slow <= 0) return false;
  if (!emaNotFalling(ema20, index)) return false;
  if (isCapitulationCandle(bar, options.atr14 ?? null)) return false;
  // Prime RSI is 48–72. The soft band 48–52 needs RVOL ≥ 0.75 or RS ≥ +4%.
  if (rsiNow != null && !primeRsiOk(rsiNow, relativeStrength, options.rvol ?? null)) return false;
  const spread = (fast - slow) / slow;
  return spread > 0 && spread <= YOUNG_SPREAD_MAX && bar.close > 0;
}

/** True when ATR(14) / close is above the volatility ceiling. */
export function atrPercentTooHigh(close: number, atr14: number | null): boolean {
  return atr14 != null && atr14 > 0 && close > 0 && atr14 / close > MAX_ATR_PERCENT;
}

/** Prime volume gate. A missing RVOL does not clear 0.60. */
export function primeVolumeOk(rvol: number | null): boolean {
  return rvol != null && rvol >= PRIME_RVOL_FLOOR;
}

function primeRsiOk(rsi: number, relativeStrength: number | null, rvol: number | null): boolean {
  if (rsi < PRIME_RSI_MIN || rsi > PRIME_RSI_MAX) return false;
  if (rsi > PRIME_RSI_CONFIRM_MAX) return true;
  const firmVolume = rvol != null && rvol >= PRIME_RSI_CONFIRM_RVOL;
  const firmRs = relativeStrength != null && relativeStrength >= PRIME_RSI_CONFIRM_RS;
  return firmVolume || firmRs;
}

/** Young-trend gate used by the full-risk prime trigger. */
export const YOUNG_SPREAD_MAX = 0.025;
/** Continuation trigger stops here. Wider than this stays a watch. */
export const CONTINUATION_SPREAD_MAX = 0.05;
export const QUIET_RVOL = 0.85;
export const CLOSE_NEAR_EMA = 0.025;

export type TriggerTier = "prime" | "standard";

export function emaSpreadRatio(fast: number | null, slow: number | null): number | null {
  if (fast == null || slow == null || slow <= 0) return null;
  return (fast - slow) / slow;
}

/** Quiet volume, a red pullback day, a close within 2.5% of EMA 20, or a strong bullish reversal bounce. */
export function continuationTraitCount(bar: PriceBar, ema20: number | null, rvol: number | null): number {
  let count = 0;
  if (rvol != null && rvol <= QUIET_RVOL) count += 1;
  if (bar.close < bar.open) count += 1;
  if (ema20 != null && ema20 > 0 && (bar.close - ema20) / ema20 <= CLOSE_NEAR_EMA) count += 1;
  if (bar.close > bar.open && closeLocationValue(bar) >= 0.6) count += 1;
  return count;
}

/**
 * Standard is a v1.2 pullback whose EMA spread is between 2.5% and 5.0%
 * and that shows at least two of the four continuation traits.
 * Does not apply the Prime RVOL, RSI, or sector gates.
 */
export function standardContinuationPasses(
  bars: readonly PriceBar[],
  ema20: readonly (number | null)[],
  ema50: readonly (number | null)[],
  index: number,
  relativeStrength: number | null,
  volumeOk: boolean,
  rvol: number | null,
  atr14: number | null = null,
  rsi?: number | null,
): boolean {
  if (
    !pullbackEntryPasses(bars, ema20, ema50, index, relativeStrength, volumeOk, {
      version: "v1.2",
      checkVolume: true,
      atr14,
      rsi,
    })
  ) {
    return false;
  }
  if (!emaNotFalling(ema20, index) || isCapitulationCandle(bars[index], atr14)) return false;
  const spread = emaSpreadRatio(ema20[index], ema50[index]);
  if (spread == null || spread <= YOUNG_SPREAD_MAX || spread > CONTINUATION_SPREAD_MAX) return false;
  return continuationTraitCount(bars[index], ema20[index], rvol) >= STANDARD_TRAIT_MIN;
}

/**
 * Prime is the full v1.3 young trend with RVOL ≥ 0.60.
 * Standard is the wider continuation path. Sector strength is applied by the caller.
 * Both tiers are skipped when ATR is more than 6% of price.
 */
export function classifyTriggerTier(
  bars: readonly PriceBar[],
  ema20: readonly (number | null)[],
  ema50: readonly (number | null)[],
  index: number,
  relativeStrength: number | null,
  volumeOk: boolean,
  rvol: number | null,
  atr14: number | null = null,
  rsi?: number | null,
): TriggerTier | null {
  const close = bars[index]?.close ?? 0;
  // Volatility ceiling applies to Prime and Standard before either path is accepted.
  if (atrPercentTooHigh(close, atr14)) return null;
  if (
    primeVolumeOk(rvol) &&
    pullbackEntryPasses(bars, ema20, ema50, index, relativeStrength, volumeOk, {
      version: "v1.3",
      checkVolume: true,
      atr14,
      rvol,
      rsi,
    })
  ) {
    return "prime";
  }
  return standardContinuationPasses(bars, ema20, ema50, index, relativeStrength, volumeOk, rvol, atr14, rsi)
    ? "standard"
    : null;
}

import type { PriceBar } from "./series";
import { ema } from "./series";

/** Close location value: where the close sits inside the day's range (0–1). */
export function closeLocationValue(bar: PriceBar): number {
  const span = bar.high - bar.low;
  if (span <= 0) return 0.5;
  return (bar.close - bar.low) / span;
}

/**
 * Wilder ATR(14) on true range, seeded over bars[1..period] so every TR term
 * incorporates the prior close (overnight gap). First defined value sits at index `period`.
 */
export function atrWilder(bars: readonly PriceBar[], period = 14): (number | null)[] {
  const out: (number | null)[] = Array(bars.length).fill(null);
  if (bars.length <= period || period < 1) return out;
  const tr: number[] = Array(bars.length).fill(0);
  for (let i = 1; i < bars.length; i += 1) {
    const prevClose = bars[i - 1].close;
    tr[i] = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - prevClose),
      Math.abs(bars[i].low - prevClose),
    );
  }
  let sum = 0;
  for (let i = 1; i <= period; i += 1) sum += tr[i];
  let prev = sum / period;
  out[period] = prev;
  for (let i = period + 1; i < bars.length; i += 1) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

export function latestAtr(bars: readonly PriceBar[], period = 14): number | null {
  const series = atrWilder(bars, period);
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const value = series[i];
    if (value != null) return value;
  }
  return null;
}

/**
 * Relative volume versus the prior `lookback` sessions using a trimmed mean
 * (drops the single highest and lowest volume day when lookback >= 6) so a
 * one-day NSE block deal or index rebalance spike does not distort RVOL for a month.
 */
export function relativeVolumeAt(bars: readonly PriceBar[], index: number, lookback = 20): number | null {
  if (index < lookback || lookback < 1) return null;
  const today = bars[index]?.volume;
  if (today == null || today <= 0) return null;
  let sum = 0;
  let minVol = Number.POSITIVE_INFINITY;
  let maxVol = Number.NEGATIVE_INFINITY;
  for (let k = index - lookback; k < index; k += 1) {
    const volume = bars[k]?.volume;
    if (volume == null || volume <= 0) return null;
    sum += volume;
    if (volume < minVol) minVol = volume;
    if (volume > maxVol) maxVol = volume;
  }
  const baseline = lookback >= 6 ? (sum - minVol - maxVol) / (lookback - 2) : sum / lookback;
  if (baseline <= 0) return null;
  return today / baseline;
}

export function sessionReturnAt(closes: readonly number[], index: number, lookback: number): number | null {
  const close = closes[index];
  const base = closes[index - lookback];
  if (close == null || base == null || base <= 0 || index < lookback) return null;
  return close / base - 1;
}

/** 0–100 when close > EMA 20 > EMA 50 on the latest bar. */
export function emaTrendScore(closes: readonly number[]): number | null {
  if (closes.length < 50) return null;
  const ema20 = ema([...closes], 20);
  const ema50 = ema([...closes], 50);
  const i = closes.length - 1;
  const close = closes[i];
  const fast = ema20[i];
  const slow = ema50[i];
  if (fast == null || slow == null) return null;
  if (close > fast && fast > slow) return 100;
  if (close > fast) return 65;
  if (close > slow) return 40;
  return 15;
}

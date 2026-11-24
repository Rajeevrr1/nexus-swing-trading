import { atrWilder } from "../analysis/indicators";
import type { PriceBar } from "../analysis";
import { ema } from "../analysis";
import { DEFAULT_RISK_SETTINGS, type RiskCapitalSettings } from "./settings";

export interface PositionSizingResult {
  entryPrice: number;
  initialStopLoss: number;
  atr14: number | null;
  suggestedQty: number;
  capitalUsed: number;
  riskPerShare: number;
}

/** Stop must sit at least this far under entry. */
export const MIN_STOP_DISTANCE = 0.025;
/**
 * Soft cut when the sector already has an open position.
 * Applied to the regime risk scale before the open-book cap. It does not block the name.
 */
export const SECTOR_OVERLAP_SCALE = 0.7;

export interface PositionSizingOptions {
  /**
   * Leftover rupee risk under the open-book cap.
   * Omit for watches. A budget below one share of risk forces quantity to 0.
   */
  remainingOpenRisk?: number;
}

export function initialStopLevel(bar: PriceBar, ema20: number, atr14: number): number {
  const anchor = Math.min(bar.low, ema20);
  return anchor - 0.5 * atr14;
}

/** Push a tight ATR stop down so risk is at least 2.5% of entry. */
export function applyMinStopDistance(entry: number, calculatedStop: number): number {
  if (!(entry > 0)) return calculatedStop;
  return Math.min(calculatedStop, entry * (1 - MIN_STOP_DISTANCE));
}

/** Rupee risk of one open position. Missing or tight stops use the 2.5% floor. */
export function positionRiskRupees(input: { entry: number; quantity: number; stop: number | null }): number {
  const { entry, quantity, stop } = input;
  if (!(entry > 0) || !(quantity > 0)) return 0;
  const distance = stop != null && Number.isFinite(stop) && stop < entry ? entry - stop : entry * MIN_STOP_DISTANCE;
  return quantity * Math.max(distance, entry * MIN_STOP_DISTANCE);
}

/** Whole shares whose risk fits in the leftover book budget. */
export function sharesWithinRiskBudget(riskPerShare: number, budget: number): number {
  if (!(riskPerShare > 0) || !(budget > 0)) return 0;
  return Math.floor(budget / riskPerShare);
}

export function scaleForSectorOverlap(riskScale: number, sectorAlreadyOpen: boolean): number {
  if (!sectorAlreadyOpen || !(riskScale > 0)) return riskScale;
  return riskScale * SECTOR_OVERLAP_SCALE;
}

/**
 * Live suggested quantity from capital, stop distance, regime scale, and optional book cap.
 * Backtest uses fixed 20% position weight. Live sizing uses dynamic risk-based quantity.
 */
export function computePositionSizing(
  bars: readonly PriceBar[],
  settings: RiskCapitalSettings = DEFAULT_RISK_SETTINGS,
  riskScale = 1,
  options?: PositionSizingOptions,
): PositionSizingResult | null {
  const series = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  const index = series.length - 1;
  if (index < 50) return null;
  const bar = series[index];
  const closes = series.map((row) => row.close);
  const ema20Series = ema(closes, 20);
  const fast = ema20Series[index];
  const atrSeries = atrWilder(series, 14);
  const atr14 = atrSeries[index];
  if (fast == null || atr14 == null || atr14 <= 0) return null;
  const entryPrice = bar.close;
  // Anchor − 0.5×ATR, then enforce a 2.5% minimum distance from entry.
  const initialStopLoss = applyMinStopDistance(entryPrice, initialStopLevel(bar, fast, atr14));
  const riskPerShare = Math.max(entryPrice - initialStopLoss, entryPrice * MIN_STOP_DISTANCE);
  const riskRupees = settings.totalCapital * (settings.riskPercent / 100) * riskScale;
  const rawShares = riskPerShare > 0 ? Math.floor(riskRupees / riskPerShare) : 0;
  const maxCapShares = entryPrice > 0
    ? Math.floor((settings.totalCapital * (settings.maxPositionCapPercent / 100)) / entryPrice)
    : 0;
  let suggestedQty = Math.max(0, Math.min(rawShares, maxCapShares));
  // Open-book cap. Passed only for executable triggers, after regime and sector scaling.
  if (options?.remainingOpenRisk != null) {
    suggestedQty = Math.min(suggestedQty, sharesWithinRiskBudget(riskPerShare, options.remainingOpenRisk));
  }
  return {
    entryPrice,
    initialStopLoss,
    atr14,
    suggestedQty,
    capitalUsed: suggestedQty * entryPrice,
    riskPerShare,
  };
}

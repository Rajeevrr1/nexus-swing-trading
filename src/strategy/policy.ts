import { formatInr, type PriceBar } from "../analysis";
import { applyMinStopDistance, initialStopLevel } from "../risk/positionSizing";
import type { MarketRegimeTier } from "../market/status";
import type { TriggerTier } from "./pullback";

/** Down close after this open gain books profit on legacy v1.2/v1.3 full-exit segments. */
export const PROTECT_GAIN = 0.06;
/**
 * +6% give-back also needs a red candle, or RVOL above this when volume exists.
 * Missing volume does not satisfy the RVOL leg.
 */
export const PROTECT_RVOL = 0.7;
/**
 * v1.4 Prime-only desk gate. Standard continuation setups (spread 2.5%–5.0%) were net-negative
 * after NSE delivery friction across 3.5y (−0.15%/trade) and 1y (PF 0.24), so they remain Watch only.
 */
export const ALLOW_STANDARD_DESK_ENTRIES = false;
/** v1.4 Tranche 1 target: book 50% at +6% and raise runner stop to entry + 1.5%. */
export const TRANCHE_T1_GAIN = 0.06;
/** Share fraction locked at T1; remaining 50% trails EMA 20 without a +12% cap. */
export const TRANCHE_T1_FRACTION = 0.5;
/** 10-session time stop exits only dead/flat trades below +2% gain; active winners keep riding EMA 20. */
export const DEAD_MONEY_GAIN_MIN = 0.02;
/** Shown on an open dead-money position once it has been held 10 sessions without +2% follow-through. */
export const HOLD_REVIEW_MESSAGE = "Held 10 sessions with gain under +2%. Exit dead money.";
/** Minimum full-profit distance for legacy full-exit segments and reference R:R calculation. */
export const FULL_PROFIT = 0.12;
/** Reward multiple applied to the initial stop distance. */
export const TARGET_R_MULTIPLE = 1.8;
/** Legacy alias used by portfolio UI copy. */
export const GOOD_PROFIT = 0.08;
/** Peak gain that arms the breakeven+ stop. Same bar as the +6% runner. */
export const RATCHET_PEAK = PROTECT_GAIN;
/** Stop floor after ratchet: entry + 1.5%. */
export const RATCHET_FLOOR = 0.015;
/** Max concurrent desk positions in green regime. */
export const MAX_DESK_SLOTS = 5;
/** Max open names in one sector. */
export const MAX_PER_SECTOR = 2;
/**
 * Position weight used for the backtest equity curve and drawdown.
 * Backtest uses fixed 20% position weight. Live sizing uses dynamic risk-based quantity.
 */
export const POSITION_WEIGHT = 0.2;
/** Max hold in trading sessions. */
export const MAX_HOLD_SESSIONS = 10;

export type ExitAction = "stop" | "trend" | "book_full" | "book_protect" | "time" | null;
export type SignalId = "exit" | "book" | "caution" | "hold" | "wait";
export type Tone = "strong" | "watch" | "weak";

export interface PositionSignal {
  id: SignalId;
  label: string;
  tone: Tone;
  reason: string;
}

export interface BarExitState {
  open: number;
  high: number;
  low: number;
  close: number;
  previousClose: number;
  ema20: number | null;
  gain: number;
  held: number;
  peak: number;
  entry: number;
  stop: number;
  /** Original frozen stop at entry so 1.8R profit targets never collapse after stop ratcheting. */
  initialStop?: number | null;
  /** Null when the bar has no usable volume. The +6% filter treats that as not heavy. */
  rvol?: number | null;
}

export interface ExitDecision {
  action: Exclude<ExitAction, null>;
  reason: string;
  why: string;
  price: number;
}

export interface TrancheLeg {
  action: "hold" | "book" | "exit" | "trail";
  label: string;
  tone: Tone;
  detail: string;
}

export interface TrancheDecision {
  t1: TrancheLeg;
  t2: TrancheLeg;
  summary: string;
  lockedProfitPerShare: number | null;
  runnerStopLevel: number | null;
}

/** Hard stop at entry bar: min(low, EMA20) − 0.5×ATR, at least 2.5% under the close. */
export function freezeEntryStop(bar: PriceBar, ema20: number, atr14: number): number {
  return Number(applyMinStopDistance(bar.close, initialStopLevel(bar, ema20, atr14)).toFixed(2));
}

/** After peak ≥ +6%, raise stop to at least entry + 1.5%. The initial stop stands until then. */
export function ratchetStop(entry: number, peak: number, currentStop: number): number {
  if (peak < entry * (1 + RATCHET_PEAK)) return currentStop;
  return Math.max(currentStop, Number((entry * (1 + RATCHET_FLOOR)).toFixed(2)));
}

/** Runner stop once +6% is armed: max(entry, EMA20). */
export function runnerStopLevel(entry: number, ema20: number | null, initialStop: number | null, gain: number): number {
  if (gain >= PROTECT_GAIN) {
    return ema20 != null && Number.isFinite(ema20) ? Math.max(entry, ema20) : entry;
  }
  return initialStop ?? (ema20 != null && Number.isFinite(ema20) ? ema20 : entry);
}

/**
 * Target is the farther of +12% and 1.8 times the stop distance.
 * A missing or non-positive risk distance keeps the +12% floor.
 */
export function profitTargetPrice(entry: number, stop: number | null): number {
  const risk = stop != null && entry > stop ? entry - stop : 0;
  return entry + Math.max(entry * FULL_PROFIT, risk * TARGET_R_MULTIPLE);
}

export interface TrancheBarState {
  open: number;
  high: number;
  low: number;
  close: number;
  ema20: number | null;
  gain: number;
  held: number;
  entry: number;
  /** Start-of-day active stop (initial stop before T1/ratchet, or entry + 1.5% on subsequent sessions). */
  stop: number;
  /** True once T1 (50%) has already been booked on a prior session. */
  t1Booked: boolean;
}

export interface TrancheBarStep {
  /** Filled today if T1 (+6%) was reached for the first time before a stop breach. */
  t1Fill: { price: number; fraction: number } | null;
  /** Closes all remaining shares today (100% if T1 not booked, or remaining 50% T2 runner). */
  fullExit: ExitDecision | null;
}

/**
 * 10-session dead-money time exit: applies only if T1 has not been booked and open gain < +2%.
 * Winning trends (+2%+ or T1 already booked) stay open to trail EMA 20.
 */
export function isDeadMoneyTimeExit(held: number, gain: number, t1Booked = false): boolean {
  return held >= MAX_HOLD_SESSIONS && !t1Booked && gain < DEAD_MONEY_GAIN_MIN;
}

/**
 * Causal single-bar evaluator for the v1.4 50/50 Tranche exit:
 *   1. Check start-of-day hard/protective stop FIRST (zero intrabar look-ahead).
 *   2. Book T1 (50%) if high >= entry × 1.06 and not already booked.
 *   3. Apply 10-session time stop ONLY to dead money (< +2% and T1 unbooked).
 *   4. Trail remaining shares (T2) freely on close < EMA 20 (no +12% cap, no +6% down-close shakeout).
 * Note: Caller ratchets stop to entry + 1.5% for the NEXT session only if fullExit is null.
 */
export function evaluateTrancheBarStep(state: TrancheBarState): TrancheBarStep {
  if (state.stop > 0 && state.low <= state.stop) {
    const price = state.open <= state.stop ? state.open : state.stop;
    const protectedWin = price > state.entry;
    return {
      t1Fill: null,
      fullExit: {
        action: protectedWin ? "book_protect" : "stop",
        reason: protectedWin ? "Book Profit" : "Stop Loss",
        why: protectedWin
          ? `Runner protected at breakeven+ stop (${formatInr(state.stop)})`
          : state.open <= state.stop
            ? `Gap down below hard stop anchor (${formatInr(state.stop)})`
            : `Hit hard stop anchor (${formatInr(state.stop)})`,
        price,
      },
    };
  }

  let t1Fill: TrancheBarStep["t1Fill"] = null;
  const t1Target = state.entry * (1 + TRANCHE_T1_GAIN);
  if (!state.t1Booked && state.entry > 0 && state.high >= t1Target) {
    const price = state.open >= t1Target ? state.open : t1Target;
    t1Fill = { price, fraction: TRANCHE_T1_FRACTION };
  }

  const t1NowBooked = state.t1Booked || t1Fill != null;
  if (isDeadMoneyTimeExit(state.held, state.gain, t1NowBooked)) {
    return {
      t1Fill,
      fullExit: {
        action: "time",
        reason: "Time",
        why: `Held ${MAX_HOLD_SESSIONS} sessions with gain under +${(DEAD_MONEY_GAIN_MIN * 100).toFixed(0)}% (dead money)`,
        price: state.close,
      },
    };
  }

  if (state.ema20 != null && state.close < state.ema20) {
    return {
      t1Fill,
      fullExit: {
        action: "trend",
        reason: "Exit",
        why: t1NowBooked ? "T2 runner exited on close below EMA 20" : "Close fell below EMA 20",
        price: state.close,
      },
    };
  }

  return { t1Fill, fullExit: null };
}

/**
 * Unknown and red block all new entries.
 * v1.4 Prime-only desk: Standard is blocked when ALLOW_STANDARD_DESK_ENTRIES is false.
 * Amber and Green allow Prime (0.5× in Amber, 1.0× in Green or 0.5× if EMA 20 falling).
 */
export function allowNewEntry(tier: MarketRegimeTier, trigger: TriggerTier | null): boolean {
  if (trigger == null) return false;
  if (tier === "unknown" || tier === "red") return false;
  if (trigger === "standard" && !ALLOW_STANDARD_DESK_ENTRIES) return false;
  if (tier === "amber") return trigger === "prime";
  return true;
}

export interface RegimeRiskOptions {
  /** Green only. EMA 20 is below its value 5 sessions ago. */
  ema20Falling?: boolean;
}

/**
 * Sizing scale for one trigger.
 * Unknown/red → 0. Standard → 0 when Prime-only desk is active (0.5× in Green if enabled).
 * Amber Prime → 0.5×. Green Prime → 1× (0.5× when Nifty EMA 20 is falling).
 */
export function riskScaleForRegime(
  tier: MarketRegimeTier,
  trigger: TriggerTier | null,
  options?: RegimeRiskOptions,
): number {
  if (tier === "unknown" || tier === "red") return 0;
  if (trigger === "standard" && !ALLOW_STANDARD_DESK_ENTRIES) return 0;
  if (tier === "amber") return trigger === "standard" ? 0 : 0.5;
  if (options?.ema20Falling) return 0.5;
  return trigger === "standard" ? 0.5 : 1;
}

export function maxSlotsForRegime(tier: MarketRegimeTier): number {
  if (tier === "unknown" || tier === "red") return 0;
  if (tier === "amber") return 3;
  return MAX_DESK_SLOTS;
}

function sortedBars(bars: readonly PriceBar[] | undefined): PriceBar[] {
  if (!bars || bars.length === 0) return [];
  return [...bars].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * +6% give-back exit, shared by the live badge and the backtest.
 * Close must be under the prior close, and the day must be red (close < open) or RVOL > 0.70.
 */
export function protectGivebackExit(input: {
  gain: number;
  close: number;
  open: number | null;
  previousClose: number | null;
  rvol: number | null;
}): boolean {
  if (input.gain < PROTECT_GAIN) return false;
  if (input.previousClose == null || !(input.close < input.previousClose)) return false;
  const redCandle = input.open != null && input.close < input.open;
  const heavyVolume = input.rvol != null && input.rvol > PROTECT_RVOL;
  return redCandle || heavyVolume;
}

/**
 * Sessions after the entry bar. Entry day is 0, matching the backtest time stop.
 * Returns null when the entry date is not in the loaded bars.
 */
export function sessionsHeld(bars: readonly PriceBar[] | undefined, entryDate: string | null | undefined): number | null {
  if (!entryDate) return null;
  const sorted = sortedBars(bars);
  const entryIndex = sorted.findIndex((bar) => bar.date === entryDate);
  if (entryIndex < 0) return null;
  return sorted.length - 1 - entryIndex;
}

/** Highest high from the entry session through the latest bar. Null when the entry date is missing. */
export function peakHighSinceEntry(bars: readonly PriceBar[] | undefined, entryDate: string | null | undefined): number | null {
  if (!entryDate) return null;
  const sorted = sortedBars(bars);
  const entryIndex = sorted.findIndex((bar) => bar.date === entryDate);
  if (entryIndex < 0) return null;
  let peak = sorted[entryIndex].high;
  for (let index = entryIndex + 1; index < sorted.length; index += 1) {
    peak = Math.max(peak, sorted[index].high);
  }
  return peak;
}

/**
 * Intrabar / EOD exit used by the backtest. Same thresholds as the live badge:
 * hard stop (low) → time → full target → close under EMA20 → filtered +6% give-back.
 * A target touch closes the whole position. There is no partial fill.
 */
export function evaluateBarExit(state: BarExitState): ExitDecision | null {
  if (state.stop > 0 && state.low <= state.stop) {
    const price = state.open <= state.stop ? state.open : state.stop;
    const protectedWin = price > state.entry;
    return {
      action: protectedWin ? "book_protect" : "stop",
      reason: protectedWin ? "Book Profit" : "Stop Loss",
      why: protectedWin
        ? `Protected at breakeven+ stop (${formatInr(state.stop)}) after +${(RATCHET_PEAK * 100).toFixed(0)}% excursion`
        : state.open <= state.stop
          ? `Gap down below hard stop anchor (${formatInr(state.stop)})`
          : `Hit hard stop anchor (${formatInr(state.stop)})`,
      price,
    };
  }

  if (state.held >= MAX_HOLD_SESSIONS) {
    return { action: "time", reason: "Time", why: `Held ${MAX_HOLD_SESSIONS} sessions`, price: state.close };
  }

  const target = profitTargetPrice(state.entry, state.initialStop ?? state.stop);
  if (state.high >= target) {
    const price = state.open >= target ? state.open : target;
    const distance = state.entry > 0 ? ((target - state.entry) / state.entry) * 100 : 0;
    return {
      action: "book_full",
      reason: "Book Profit",
      why: `Full profit target (+${distance.toFixed(1)}%) reached`,
      price,
    };
  }

  if (state.ema20 != null && state.close < state.ema20) {
    return { action: "trend", reason: "Exit", why: "Close fell below EMA 20", price: state.close };
  }

  // +6% give-back: prior-close break plus a red candle or RVOL > 0.70.
  if (
    protectGivebackExit({
      gain: state.gain,
      close: state.close,
      open: state.open,
      previousClose: state.previousClose,
      rvol: state.rvol ?? null,
    })
  ) {
    return {
      action: "book_protect",
      reason: "Book Profit",
      why: "Down close after +6% on a red candle or heavy volume",
      price: state.close,
    };
  }

  return null;
}

/**
 * Live portfolio / alert badge synced to v1.4 50/50 Tranche rules:
 *   - Hard stop / protective stop / close < EMA 20: exit full remaining shares (checked on close).
 *   - Dead-money 10-session time stop: exits only if open gain < +2% and peak < +6%.
 *   - T1 (+6%): prompt to book 50% (T1), raise stop to entry + 1.5%, and trail T2 on EMA 20 (no +12% cap).
 */
export function evaluatePositionSignal(input: {
  lastClose: number;
  ema20: number | null;
  entry: number;
  bars?: readonly PriceBar[];
  initialStopLoss?: number | null;
  entryDate?: string | null;
  rsWeak?: boolean;
  /** True once T1 (50%) has already been sold in Zerodha; prevents double-prompting T1 trim. */
  t1Booked?: boolean;
}): PositionSignal {
  const initialStop = input.initialStopLoss;
  const gain = input.entry > 0 ? (input.lastClose - input.entry) / input.entry : 0;
  const peak = peakHighSinceEntry(input.bars, input.entryDate);
  const reachedT1Peak =
    Boolean(input.t1Booked) || (peak != null && input.entry > 0 && peak >= input.entry * (1 + TRANCHE_T1_GAIN));
  const protective =
    initialStop != null && Number.isFinite(initialStop)
      ? input.t1Booked
        ? Math.max(initialStop, Number((input.entry * (1 + RATCHET_FLOOR)).toFixed(2)))
        : peak != null
          ? ratchetStop(input.entry, peak, initialStop)
          : null
      : null;

  // Live stops are close-only. An intraday pierce that closes back above the stop stays open.
  if (initialStop != null && Number.isFinite(initialStop) && input.lastClose <= initialStop) {
    return {
      id: "exit",
      label: "Stop Loss",
      tone: "weak",
      reason: `Close breached the initial stop (${formatInr(initialStop)}). Stop checked on close.`,
    };
  }

  if (protective != null && initialStop != null && protective > initialStop && input.lastClose <= protective) {
    if (input.lastClose > input.entry) {
      return {
        id: "book",
        label: "Protected exit",
        tone: "strong",
        reason: `Close is through the protective runner stop (${formatInr(protective)}), entry +1.5% after a +6% peak. Exit remaining shares.`,
      };
    }
    return {
      id: "exit",
      label: "Stop Loss",
      tone: "weak",
      reason: `Close is through the protective stop (${formatInr(protective)}). Stop checked on close.`,
    };
  }

  const held = sessionsHeld(input.bars, input.entryDate);
  if (held != null && isDeadMoneyTimeExit(held, gain, reachedT1Peak)) {
    return {
      id: "exit",
      label: "Time",
      tone: "weak",
      reason: HOLD_REVIEW_MESSAGE,
    };
  }

  if (input.ema20 == null || !Number.isFinite(input.ema20)) {
    return {
      id: "wait",
      label: "Waiting",
      tone: "watch",
      reason: "EMA 20 is still loading from Kite.",
    };
  }

  if (input.lastClose < input.ema20) {
    return {
      id: "exit",
      label: "Exit",
      tone: "weak",
      reason: "Close is below EMA 20.",
    };
  }

  // v1.4 T1 partial book: at +6%+, lock 50% (T1) once; once T1 is booked, trail T2 freely on EMA 20.
  if (gain >= TRANCHE_T1_GAIN && !input.t1Booked) {
    const protectLevel = Number((input.entry * (1 + RATCHET_FLOOR)).toFixed(2));
    return {
      id: "book",
      label: "Book 50% (T1)",
      tone: "strong",
      reason: `Up +${(gain * 100).toFixed(1)}%: book 50% (T1 @ +6%+), move stop to ${formatInr(protectLevel)} (+1.5%), and trail remaining 50% (T2) on EMA 20.`,
    };
  }

  if (input.rsWeak) {
    return {
      id: "caution",
      label: "Hold / Caution",
      tone: "watch",
      reason: "Above EMA 20, but it is no longer ahead of Nifty.",
    };
  }

  return {
    id: "hold",
    label: "Hold",
    tone: "strong",
    reason: reachedT1Peak
      ? `T2 runner trailing EMA 20 with protective stop at ${formatInr(protective ?? input.entry * (1 + RATCHET_FLOOR))}.`
      : "Above EMA 20. A dip that holds the average stays open.",
  };
}

/**
 * Live 50/50 Tranche plan aligned with v1.4 policy and the backtest engine:
 *   - T1 (50% shares): lock profit at +6% (+6% target).
 *   - T2 (50% runner): move stop to entry + 1.5% and trail EMA 20 with no +12% cap.
 *   - 10-session dead-money exit applies only if open gain < +2% and T1 has not been reached.
 */
export function evaluateTranchePlan(input: {
  entry: number;
  quantity: number;
  lastClose: number;
  ema20: number | null;
  bars?: readonly PriceBar[];
  initialStopLoss?: number | null;
  entryDate?: string | null;
  t1Booked?: boolean;
}): TrancheDecision {
  const { entry, quantity, lastClose, ema20, bars, initialStopLoss, entryDate, t1Booked = false } = input;
  const t1Qty = t1Booked ? 0 : Math.max(1, Math.ceil(quantity / 2));
  const t2Qty = t1Booked ? quantity : Math.max(0, quantity - t1Qty);
  const gain = entry > 0 ? (lastClose - entry) / entry : 0;
  const runner = runnerStopLevel(entry, ema20, initialStopLoss ?? null, gain);
  const peak = peakHighSinceEntry(bars, entryDate);
  const reachedT1Peak = t1Booked || (peak != null && entry > 0 && peak >= entry * (1 + TRANCHE_T1_GAIN));
  const protective =
    initialStopLoss != null && Number.isFinite(initialStopLoss)
      ? t1Booked
        ? Math.max(initialStopLoss, Number((entry * (1 + RATCHET_FLOOR)).toFixed(2)))
        : peak != null
          ? ratchetStop(entry, peak, initialStopLoss)
          : null
      : null;
  const t1TargetPrice = entry > 0 ? entry * (1 + TRANCHE_T1_GAIN) : null;
  const activeStop =
    protective != null && initialStopLoss != null && protective > initialStopLoss
      ? Math.max(protective, ema20 ?? protective)
      : runner;

  if (initialStopLoss != null && Number.isFinite(initialStopLoss) && lastClose <= initialStopLoss) {
    return {
      t1: {
        action: "exit",
        label: "Hard Stop Breach",
        tone: "weak",
        detail: `Breached initial hard stop anchor (${formatInr(initialStopLoss)}).`,
      },
      t2: {
        action: "exit",
        label: "Hard Stop Breach",
        tone: "weak",
        detail: `Breached initial hard stop anchor (${formatInr(initialStopLoss)}).`,
      },
      summary: `Hard stop breached at ${formatInr(initialStopLoss)}. Full exit across all ${quantity} shares.`,
      lockedProfitPerShare: null,
      runnerStopLevel: initialStopLoss,
    };
  }

  if (protective != null && initialStopLoss != null && protective > initialStopLoss && lastClose <= protective) {
    const booked = lastClose > entry;
    return {
      t1: {
        action: booked ? "book" : "exit",
        label: "Protective stop",
        tone: booked ? "strong" : "weak",
        detail: `Close is through entry +1.5% (${formatInr(protective)}) after a +6% peak. Exit remaining shares.`,
      },
      t2: {
        action: booked ? "book" : "exit",
        label: "Protective stop",
        tone: booked ? "strong" : "weak",
        detail: `Close is through entry +1.5% (${formatInr(protective)}) after a +6% peak. Exit remaining shares.`,
      },
      summary: `Protective stop ${formatInr(protective)} reached. Exit remaining shares.`,
      lockedProfitPerShare: booked ? lastClose - entry : null,
      runnerStopLevel: protective,
    };
  }

  const held = sessionsHeld(bars, entryDate);
  if (held != null && isDeadMoneyTimeExit(held, gain, reachedT1Peak)) {
    return {
      t1: {
        action: "exit",
        label: "10d dead money",
        tone: "weak",
        detail: HOLD_REVIEW_MESSAGE,
      },
      t2: {
        action: "exit",
        label: "10d dead money",
        tone: "weak",
        detail: HOLD_REVIEW_MESSAGE,
      },
      summary: `${HOLD_REVIEW_MESSAGE} Full exit across all ${quantity} shares.`,
      lockedProfitPerShare: null,
      runnerStopLevel: activeStop,
    };
  }

  if (ema20 != null && Number.isFinite(ema20) && lastClose < ema20) {
    return {
      t1: {
        action: "exit",
        label: "Close < EMA 20",
        tone: "weak",
        detail: `Close is below EMA 20 (${formatInr(ema20)}).`,
      },
      t2: {
        action: "exit",
        label: "Close < EMA 20",
        tone: "weak",
        detail: `Close is below EMA 20 (${formatInr(ema20)}).`,
      },
      summary: `Close fell below EMA 20 (${formatInr(ema20)}). Exit remaining shares.`,
      lockedProfitPerShare: null,
      runnerStopLevel: ema20,
    };
  }

  const t1Ready = !t1Booked && gain >= TRANCHE_T1_GAIN;
  const protectFloor = entry > 0 ? Number((entry * (1 + RATCHET_FLOOR)).toFixed(2)) : null;

  const t1: TrancheLeg = t1Booked
    ? {
        action: "trail",
        label: "T1 Already Booked",
        tone: "strong",
        detail: `Partial profit already locked. All remaining ${quantity} shares are now your T2 runner.`,
      }
    : t1Ready
      ? {
          action: "book",
          label: `Book ${t1Qty} sh (+6%+)`,
          tone: "strong",
          detail: `T1 target reached (+${(gain * 100).toFixed(1)}%). Lock 50% (${t1Qty} shares) and let T2 ride EMA 20.`,
        }
      : reachedT1Peak
        ? {
            action: "hold",
            label: "T1 Zone Previously Hit",
            tone: "strong",
            detail: `Peak crossed +6%. If T1 (${t1Qty} sh) is already booked, manage remaining T2 on EMA 20 / ${protectFloor ? formatInr(protectFloor) : "+1.5%"} stop.`,
          }
        : {
            action: "hold",
            label: "Stalking T1 (+6%)",
            tone: gain >= 0.03 ? "strong" : "watch",
            detail: `Book 50% (${t1Qty} sh) at ${t1TargetPrice != null ? formatInr(t1TargetPrice) : "+6%"} (currently ${(gain * 100).toFixed(1)}%).`,
          };

  const t2: TrancheLeg =
    t1Ready || reachedT1Peak
      ? {
          action: "trail",
          label: `Trail ${t2Qty} sh on EMA 20`,
          tone: "strong",
          detail: `No +12% cap. Protective stop ${protectFloor ? formatInr(protectFloor) : "+1.5%"}; exit T2 only on close below EMA 20 (${ema20 ? formatInr(ema20) : "—"}) or protective stop.`,
        }
      : {
          action: "hold",
          label: "Runner on EMA 20",
          tone: "watch",
          detail: `Initial stop ${initialStopLoss != null ? formatInr(initialStopLoss) : "anchor"}. After +6% T1 lock, T2 rides EMA 20 freely. 10-day exit applies only if gain < +2%.`,
        };

  const summary = t1Ready
    ? `T1 +6% target reached (+${(gain * 100).toFixed(1)}%). Book 50% (${t1Qty} sh), raise stop to ${protectFloor ? formatInr(protectFloor) : "+1.5%"}, and trail remaining ${t2Qty} sh on EMA 20.`
    : reachedT1Peak
      ? `T2 runner active above EMA 20 (${(gain * 100).toFixed(1)}%). Protective stop at ${protectFloor ? formatInr(protectFloor) : "+1.5%"}.`
      : `Holding above EMA 20 (${(gain * 100).toFixed(1)}%). T1 books 50% at +6%; 10-day dead-money exit only if gain < +2%.`;

  return {
    t1,
    t2,
    summary,
    lockedProfitPerShare: t1Ready ? lastClose - entry : null,
    runnerStopLevel: activeStop,
  };
}

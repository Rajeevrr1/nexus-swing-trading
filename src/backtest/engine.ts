import { ema, formatInr, type PriceBar } from "../analysis";
import { atrWilder, closeLocationValue, relativeVolumeAt } from "../analysis/indicators";
import type { ScoredSecurity } from "../scanner";
import { computeSectorStrengthScore } from "../scanner/liveScore";
import { classifyNiftyRegime } from "../market/status";
import { chaseLimits, passesLiveDeskEntry, scoreSetupQuality } from "../recommendations/setup";
import {
  atrPercentTooHigh,
  primeVolumeOk,
  pullbackEntryPasses,
  wilderRsi,
} from "../strategy/pullback";
import {
  evaluateBarExit,
  evaluateTrancheBarStep,
  freezeEntryStop,
  FULL_PROFIT,
  MAX_HOLD_SESSIONS,
  MAX_PER_SECTOR,
  POSITION_WEIGHT,
  RATCHET_FLOOR,
  ratchetStop,
} from "../strategy/policy";

export type BacktestPeriod = "6m" | "1y" | "3.5y";

/** Calendar-day lookback from the last bar in the series. */
export function periodLookbackDays(period: BacktestPeriod): number {
  if (period === "3.5y") return 1278;
  if (period === "1y") return 365;
  return 183;
}

/** Days to request from Kite so the window has indicator warmup before entries. */
export function periodFetchDays(period: BacktestPeriod): number {
  if (period === "3.5y") return 1400;
  if (period === "1y") return 420;
  return 260;
}
export type SegmentId =
  | "ema"
  | "ema-rs"
  | "ema-rs-vol"
  | "full"
  | "relaxed"
  | "sector"
  | "pullback"
  | "pullback-rs"
  | "pullback-wide"
  | "pullback-nifty"
  | "pullback-lock"
  | "pullback-v13"
  | "pullback-desk"
  | "pullback-regime"
  | "swing";

/** Previous full filter. Kept so the page can compare it with the relaxed rule. */
export const STRICT_GRADE_FLOOR = 78;
/** Live A-grade floor. The relaxed filter uses this. */
export const RELAXED_GRADE_FLOOR = 75;
const SECTOR_FLOOR = 70;
const RS_LOOKBACK = 20;
const RVOL_LOOKBACK = 20;
const RSI_PERIOD = 14;
const RSI_EXTENDED = 75;
const FIVE_DAY_EXTENDED = 0.1;
const BOOK_FLOOR = 0.08;
const BOOK_CAP = FULL_PROFIT;
const TRAIL_ARM = 0.05;
const TRAIL_GIVEBACK = 0.045;
/** 20-session outperformance versus Nifty that counts as clearly stronger. */
const RS_EDGE = 0.03;

export interface BacktestTrade {
  symbol: string;
  name: string;
  entryDate: string;
  exitDate: string | null;
  entry: number;
  exit: number;
  returnPct: number;
  /** Calendar days from entry to exit. Zero while the trade is still open. */
  holdDays: number;
  result: "Win" | "Loss" | "Open";
  reason: string;
  why: string;
}

export interface SegmentResult {
  id: SegmentId;
  label: string;
  summary: string;
  trades: BacktestTrade[];
  closed: number;
  open: number;
  winRate: number | null;
  averageWinner: number | null;
  averageLoser: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  /** Same book after 0.28% round-trip NSE delivery friction. */
  netProfitFactor: number | null;
  netExpectancy: number | null;
  maxDrawdown: number | null;
  netMaxDrawdown: number | null;
  averageHoldDays: number | null;
  maxConsecutiveLosses: number;
  totalReturn: number;
  netTotalReturn: number;
  volumeApplied: boolean;
}

/** STT, stamp, exchange, GST, DP, and a small bid-ask slip on an NSE delivery round trip. */
export const ROUND_TRIP_FRICTION = 0.0028;

export interface BacktestReport {
  period: BacktestPeriod;
  source: "kite" | "sample";
  symbols: number;
  windowStart: string;
  windowEnd: string;
  segments: SegmentResult[];
}

interface Prepared {
  security: ScoredSecurity;
  bars: PriceBar[];
  ema20: (number | null)[];
  ema50: (number | null)[];
  rsi: (number | null)[];
  atr: (number | null)[];
  ret5: (number | null)[];
  ret20: Map<string, number>;
  rvol: (number | null)[];
  hasVolume: boolean;
}

const SEGMENTS: { id: SegmentId; label: string; summary: string }[] = [
  {
    id: "pullback-lock",
    label: "v1.2 Baseline (All Pullback Triggers — Uncapped)",
    summary:
      "Every v1.2 pullback, with no limit on how many names can be open. Shared policy exits: hard stop, close below EMA 20, +12%, 10 sessions, or a down close after +6%.",
  },
  {
    id: "pullback-v13",
    label: "v1.3 Empirical High-Quality Filter (Data-Driven Edge)",
    summary:
      "Same shared exits as v1.2. Enforces non-falling EMA 20, blocks capitulation candles and RED/unknown regime, requires ATR ≤ 6%, RVOL ≥ 0.60, RSI 48–72 (with 48–52 RVOL/RS confirmation), and EMA 20 above EMA 50 within 2.5%.",
  },
  {
    id: "pullback-desk",
    label: "v1.4 Prime-Only Desk (50/50 Tranche · Dead-Money TS · Max 5 / 2 per Sector)",
    summary:
      "Prime-only entries (EMA spread ≤ 2.5%, point-in-time sector ≥ 55, RVOL ≥ 0.60, ATR ≤ 6%, turnover ≥ ₹20 crore; Standard paused). Exit: book 50% (T1) at +6% and raise stop to +1.5%, trail remaining 50% (T2) on EMA 20 with no +12% cap; 10-session time stop exits only dead money (< +2%). Daily MTM equity at 20% per slot.",
  },
];

/** Stable v1.2 row, plus the two comparisons that were not adopted. */
export function runBacktest(input: {
  period: BacktestPeriod;
  source: "kite" | "sample";
  securities: readonly ScoredSecurity[];
  histories: Record<string, PriceBar[]>;
  nifty?: readonly PriceBar[];
}): BacktestReport {
  const prepared = prepare(input.securities, input.histories);
  const benchmark = benchmarkReturns(prepared);
  const dailySectorScores = buildDailySectorScores(prepared);
  const market = niftyContext(input.nifty ?? []);
  let windowStart = "";
  let windowEnd = "";
  for (const series of prepared) {
    const end = series.bars[series.bars.length - 1]?.date ?? "";
    const start = end ? shiftDate(end, -periodLookbackDays(input.period)) : "";
    if (end && (!windowEnd || end > windowEnd)) windowEnd = end;
    if (start && (!windowStart || start < windowStart)) windowStart = start;
  }

  return {
    period: input.period,
    source: input.source,
    symbols: prepared.length,
    windowStart,
    windowEnd,
    segments: SEGMENTS.map((segment) =>
      segment.id === "pullback-desk"
        ? runDeskPortfolio(segment, prepared, market, dailySectorScores, input.period)
        : runSegment(segment, prepared, benchmark, market, dailySectorScores, input.period),
    ),
  };
}

interface NiftyContext {
  ready: boolean;
  bars: PriceBar[];
  regime: Map<string, boolean>;
  regimeTier: Map<string, "green" | "amber" | "red" | "unknown">;
  ema20Falling: Map<string, boolean>;
  aboveEma20: Map<string, boolean>;
  ret20: Map<string, number>;
}

function runSegment(
  segment: { id: SegmentId; label: string; summary: string },
  seriesList: Prepared[],
  benchmark: Map<string, number>,
  market: NiftyContext,
  dailySectorScores: Map<string, Map<string, number>>,
  period: BacktestPeriod,
): SegmentResult {
  const trades: BacktestTrade[] = [];
  const volumeApplied = seriesList.some((series) => series.hasVolume);
  for (const series of seriesList) {
    const end = series.bars[series.bars.length - 1]?.date;
    if (!end) continue;
    const start = shiftDate(end, -periodLookbackDays(period));
    let position: {
      index: number;
      entry: number;
      peak: number;
      why: string;
      stop: number;
      initialStop: number;
    } | null = null;
    let pendingSignal: { signalIndex: number; stop: number; maxChasePrice: number; why: string } | null = null;
    for (let i = 0; i < series.bars.length; i += 1) {
      const bar = series.bars[i];
      const average = series.ema20[i];
      const slow = series.ema50[i];

      // 1. Morning execution of pending signal (09:15 AM Open fill)
      if (!position && pendingSignal) {
        if (i === pendingSignal.signalIndex + 1) {
          // Gap guard: skip order if open gapped beyond max chase threshold or collapsed below stop
          if (bar.open <= pendingSignal.maxChasePrice && bar.open > pendingSignal.stop) {
            position = {
              index: i,
              entry: bar.open,
              // Start-of-day peak is the fill price so Day 0 cannot ratchet before evaluating Day 0's low.
              peak: bar.open,
              stop: pendingSignal.stop,
              initialStop: pendingSignal.stop,
              why: `${pendingSignal.why} · Next-morning open fill ${formatInr(bar.open)} (Max chase ${formatInr(pendingSignal.maxChasePrice)})`,
            };
          }
        }
        pendingSignal = null;
      }

      // 2. Session Trade Management & Exits
      // Evaluate exits FIRST against the start-of-day stop (causal — no intrabar ratchet look-ahead).
      let justExited = false;
      if (position && i >= position.index) {
        const gain = bar.close / position.entry - 1;
        const held = i - position.index;
        const exit = exitReason(segment.id, {
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          previousClose: i > 0 ? series.bars[i - 1].close : bar.open,
          ema20: average,
          ema50: slow,
          gain,
          held,
          peak: position.peak,
          entry: position.entry,
          stop: position.stop,
          initialStop: position.initialStop,
          atr14: series.atr[i],
          rvol: series.rvol[i],
        });
        if (exit) {
          if (series.bars[position.index].date >= start) {
            trades.push(
              makeTrade(
                series.security,
                series.bars[position.index],
                bar,
                exit.reason,
                `${position.why}. Exit: ${exit.why}`,
                exit.price,
                position.entry,
              ),
            );
          }
          position = null;
          justExited = true;
        } else {
          // Survived the session: update peak and ratchet stop for the NEXT session.
          position.peak = Math.max(position.peak, bar.high);
          position.stop = ratchetStop(position.entry, position.peak, position.stop);
        }
      }

      // 3. Evening Scan for New Setups
      if (!justExited && !position && bar.date >= start && average != null && slow != null) {
        const setup = entrySetup(segment.id, series, i, benchmark, market, dailySectorScores, volumeApplied);
        if (setup) {
          const stop = entryStop(segment.id, series, i);
          const atr = series.atr[i];
          const limits = chaseLimits(bar.close, stop, atr);
          pendingSignal = {
            signalIndex: i,
            stop,
            maxChasePrice: limits.maxChasePrice,
            why: entryWhy(segment.id, series, i, benchmark, market, dailySectorScores, volumeApplied),
          };
        }
      }
    }
    if (position) {
      const entryBar = series.bars[position.index];
      const last = series.bars[series.bars.length - 1];
      if (entryBar.date >= start) {
        trades.push(makeTrade(series.security, entryBar, last, "Open", position.why, last.close, position.entry));
      }
    }
  }

  return summarize(segment, trades.sort((a, b) => (b.exitDate ?? b.entryDate).localeCompare(a.exitDate ?? a.entryDate)), volumeApplied);
}

function entrySetup(
  id: SegmentId,
  series: Prepared,
  index: number,
  benchmark: Map<string, number>,
  market: NiftyContext,
  dailySectorScores: Map<string, Map<string, number>>,
  volumeApplied: boolean,
): boolean {
  if (isPullback(id)) return pullbackSetup(id, series, index, market, dailySectorScores);
  if (index < 1) return false;
  const today = stacked(series, index);
  const yesterday = stacked(series, index - 1);
  if (!today || yesterday) return false;
  if (id === "ema") return true;
  const rs = relativeStrength(series, index, benchmark);
  if (rs == null || rs <= 0) return false;
  if (id === "ema-rs") return true;
  const floor = rvolFloor(id);
  if (floor != null && volumeApplied && series.hasVolume) {
    const rvol = series.rvol[index];
    if (rvol == null || rvol < floor) return false;
  }
  if (id === "ema-rs-vol") return true;
  if (id === "full") {
    return series.security.conviction >= STRICT_GRADE_FLOOR && !extended(series, index, "either");
  }
  if (series.security.conviction < RELAXED_GRADE_FLOOR) return false;
  if (extended(series, index, "both")) return false;
  if (id === "sector") {
    const date = series.bars[index]?.date;
    const score = (date ? dailySectorScores.get(date)?.get(series.security.sector) : undefined) ?? sectorScore(series.security);
    return score >= SECTOR_FLOOR;
  }
  return true;
}

function entryWhy(
  id: SegmentId,
  series: Prepared,
  index: number,
  benchmark: Map<string, number>,
  market: NiftyContext,
  dailySectorScores: Map<string, Map<string, number>>,
  volumeApplied: boolean,
): string {
  if (isPullback(id)) return pullbackWhy(id, series, index, market);
  const parts = ["Close crossed above EMA 20 with EMA 20 above EMA 50"];
  if (id !== "ema") {
    const rs = relativeStrength(series, index, benchmark);
    parts.push(rs == null ? "RS unavailable" : `True RS ${signedPct(rs)} vs the book`);
  }
  const floor = rvolFloor(id);
  if (floor != null && volumeApplied && series.hasVolume) {
    const rvol = series.rvol[index];
    parts.push(rvol == null ? "RVOL unavailable" : `RVOL ${rvol.toFixed(2)} (need ${floor.toFixed(1)})`);
  }
  if (id === "full" || id === "relaxed" || id === "sector") {
    const gradeFloor = id === "full" ? STRICT_GRADE_FLOOR : RELAXED_GRADE_FLOOR;
    parts.push(`Grade ${series.security.conviction} (≥ ${gradeFloor})`);
    parts.push(id === "full" ? "Not extended on RSI or 5-day return" : "Not extended on both RSI and 5-day return");
  }
  if (id === "sector") {
    const date = series.bars[index]?.date;
    const score = (date ? dailySectorScores.get(date)?.get(series.security.sector) : undefined) ?? sectorScore(series.security);
    parts.push(`Sector ${score} (≥ ${SECTOR_FLOOR})`);
  }
  return parts.join(" · ");
}

export interface ExitState {
  open: number;
  high: number;
  low: number;
  close: number;
  previousClose: number;
  ema20: number | null;
  ema50: number | null;
  gain: number;
  held: number;
  peak: number;
  entry: number;
  stop: number;
  /** Original frozen stop at entry so profitTargetPrice preserves 1.8R after ratcheting. */
  initialStop?: number | null;
  atr14: number | null;
  rvol?: number | null;
}

export interface ExitDecision {
  reason: string;
  why: string;
  price?: number;
}

function exitReason(id: SegmentId, state: ExitState): ExitDecision | null {
  if (id === "swing") return swingExit(state);

  if (id === "pullback-lock" || id === "pullback-v13" || id === "pullback-desk") {
    const decision = evaluateBarExit({
      open: state.open,
      high: state.high,
      low: state.low,
      close: state.close,
      previousClose: state.previousClose,
      ema20: state.ema20,
      gain: state.gain,
      held: state.held,
      peak: state.peak,
      entry: state.entry,
      stop: state.stop,
      initialStop: state.initialStop,
      rvol: state.rvol,
    });
    if (!decision) return null;
    return { reason: decision.reason, why: decision.why, price: decision.price };
  }

  if (state.stop > 0 && state.low <= state.stop) {
    const price = state.open <= state.stop ? state.open : state.stop;
    const isProtectedWin = price > state.entry;
    return {
      reason: isProtectedWin ? "Book Profit" : "Stop Loss",
      why: isProtectedWin
        ? `Protected at breakeven+ stop (${formatInr(state.stop)})`
        : state.open <= state.stop
          ? `Gap down below hard stop anchor (${formatInr(state.stop)})`
          : `Hit hard stop anchor (${formatInr(state.stop)})`,
      price,
    };
  }

  if (state.held >= MAX_HOLD_SESSIONS) {
    return { reason: "Time", why: `Held ${MAX_HOLD_SESSIONS} sessions`, price: state.close };
  }

  if (state.high >= state.entry * (1 + BOOK_CAP)) {
    const price = state.open >= state.entry * (1 + BOOK_CAP) ? state.open : state.entry * (1 + BOOK_CAP);
    return { reason: "Book Profit", why: "Full profit target (+12%) reached", price };
  }

  if (state.ema20 != null && state.close < state.ema20) {
    return { reason: "Exit", why: "Close fell below EMA 20", price: state.close };
  }

  if (state.gain >= BOOK_FLOOR && state.close < state.previousClose) {
    return {
      reason: "Book Profit",
      why: "Profit booked inside the +8% to +12% band",
      price: state.close,
    };
  }

  if (
    (id === "full" || id === "relaxed" || id === "sector") &&
    state.peak >= state.entry * (1 + TRAIL_ARM) &&
    state.close <= state.peak * (1 - TRAIL_GIVEBACK)
  ) {
    return { reason: "Trail", why: "Gave back 4% from the peak after a 5% gain", price: state.close };
  }

  return null;
}

function isPullback(id: SegmentId): boolean {
  return (
    id === "pullback" ||
    id === "pullback-rs" ||
    id === "pullback-wide" ||
    id === "pullback-nifty" ||
    id === "pullback-lock" ||
    id === "pullback-v13" ||
    id === "pullback-desk" ||
    id === "pullback-regime" ||
    id === "swing"
  );
}

function pullbackSetup(
  id: SegmentId,
  series: Prepared,
  index: number,
  market: NiftyContext,
  dailySectorScores: Map<string, Map<string, number>>,
): boolean {
  const wide =
    id === "pullback-wide" || id === "pullback-nifty" || id === "pullback-lock" || id === "pullback-v13";
  const band = wide ? 0.035 : 0.015;
  const edge = niftyEdge(series, index, market);
  const volumeOk = !extremelyWeakVolume(series, index);
  if (id === "pullback-v13" || id === "pullback-desk") {
    return refinedPullback(series, index, market, dailySectorScores)?.ok === true;
  }
  if (id === "pullback-lock") {
    return pullbackEntryPasses(series.bars, series.ema20, series.ema50, index, edge, volumeOk, {
      version: "v1.2",
      checkVolume: true,
      rsEdge: RS_EDGE,
      atr14: series.atr[index],
      rsi: series.rsi[index],
    });
  }
  if (!taggedPullback(series, index, band)) return false;
  if (id === "pullback") return true;
  if (edge == null || edge < RS_EDGE) return false;
  if (wide && extremelyWeakVolume(series, index)) return false;
  if (id === "pullback-nifty") return market.aboveEma20.get(series.bars[index].date) === true;
  if (id === "pullback-wide" || id === "pullback-rs") return true;
  return market.regime.get(series.bars[index].date) === true;
}

function pullbackWhy(id: SegmentId, series: Prepared, index: number, market: NiftyContext): string {
  const parts = ["Pullback to EMA 20 while price stayed above EMA 50. Not a fresh breakout."];
  if (id === "pullback-wide" || id === "pullback-nifty" || id === "pullback-lock" || id === "pullback-v13") {
    parts[0] = "Pullback within volatility-scaled band (1.5%–3.5%) of EMA 20 while price stayed above EMA 50. Not a fresh breakout.";
  }
  if (id !== "pullback") {
    const edge = niftyEdge(series, index, market);
    parts.push(edge == null ? "Nifty RS unavailable" : `Beat Nifty by ${signedPct(edge)} over 20 sessions`);
  }
  if (id === "pullback-wide" || id === "pullback-nifty" || id === "pullback-lock" || id === "pullback-v13") {
    parts.push(id === "pullback-v13" ? "RVOL ≥ 0.60 and ATR ≤ 6%" : "Volume is not extremely weak");
  }
  if (id === "pullback-nifty") parts.push("Nifty close above its EMA 20");
  if (id === "pullback-lock") parts.push("A down close after +6% books the profit");
  if (id === "pullback-v13" || id === "pullback-desk") {
    parts.push("EMA 20 within 2.5% of EMA 50 · RSI 48–72 · non-falling EMA 20 · no capitulation");
  }
  if (id === "pullback-regime" || id === "swing") parts.push("Nifty close > EMA 20 > EMA 50");
  if (id === "swing") parts.push("Stop under the pullback low until +5%, then trail 4.5% from the peak or EMA 20");
  return parts.join(" · ");
}

function extremelyWeakVolume(series: Prepared, index: number): boolean {
  if (!series.hasVolume) return false;
  const value = series.rvol[index];
  return value != null && value < 0.45;
}

function taggedPullback(series: Prepared, index: number, band = 0.015): boolean {
  if (index < 21) return false;
  const bar = series.bars[index];
  const fast = series.ema20[index];
  const slow = series.ema50[index];
  const previousFast = series.ema20[index - 1];
  const previousClose = series.bars[index - 1].close;
  if (fast == null || slow == null || previousFast == null) return false;
  const uptrend = fast > slow && bar.close > slow;
  const alreadyTrending = previousClose > previousFast;
  const nearAverage = bar.low <= fast * (1 + band) && bar.close >= fast * 0.995;
  let priorHigh = series.bars[index - 20].close;
  for (let k = index - 19; k < index; k += 1) priorHigh = Math.max(priorHigh, series.bars[k].close);
  const notBreakout = bar.close <= priorHigh;
  return uptrend && alreadyTrending && nearAverage && notBreakout;
}

function niftyReturnOnOrBefore(market: NiftyContext, date: string): number | null {
  const exact = market.ret20.get(date);
  if (exact != null) return exact;
  const targetMs = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(targetMs) || market.bars.length === 0) return null;
  let lo = 0;
  let hi = market.bars.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (market.bars[mid].date <= date) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best < 0) return null;
  const hitDate = market.bars[best].date;
  const hitMs = Date.parse(`${hitDate}T00:00:00Z`);
  if (!Number.isFinite(hitMs) || targetMs - hitMs > 3 * 86_400_000) return null;
  return market.ret20.get(hitDate) ?? null;
}

/** Compounded ratio relative strength: (1 + r_stock) / (1 + r_nifty) − 1. */
function niftyEdge(series: Prepared, index: number, market: NiftyContext): number | null {
  if (!market.ready) return null;
  const date = series.bars[index]?.date;
  const stock = date ? series.ret20.get(date) : undefined;
  const nifty = date ? niftyReturnOnOrBefore(market, date) : null;
  if (stock == null || nifty == null || 1 + nifty <= 0) return null;
  return (1 + stock) / (1 + nifty) - 1;
}

function entryStop(id: SegmentId, series: Prepared, index: number): number {
  const bar = series.bars[index];
  const fast = series.ema20[index];
  const atr = series.atr[index];
  if (isPullback(id) && fast != null && atr != null && atr > 0) {
    return freezeEntryStop(bar, fast, atr);
  }
  return swingStop(series, index);
}

function swingStop(series: Prepared, index: number): number {
  let low = series.bars[index].low;
  for (let k = Math.max(0, index - 4); k <= index; k += 1) low = Math.min(low, series.bars[k].low);
  return low;
}

function swingExit(state: ExitState): ExitDecision | null {
  if (state.stop > 0 && state.low <= state.stop) {
    const price = state.open <= state.stop ? state.open : state.stop;
    return {
      reason: "Stop Loss",
      why: state.open <= state.stop
        ? `Gap down below swing stop (${formatInr(state.stop)})`
        : `Hit swing stop anchor (${formatInr(state.stop)})`,
      price,
    };
  }
  if (state.held >= MAX_HOLD_SESSIONS) return { reason: "Time", why: `Held ${MAX_HOLD_SESSIONS} sessions`, price: state.close };
  if (state.high >= state.entry * (1 + BOOK_CAP)) {
    const price = state.open >= state.entry * (1 + BOOK_CAP) ? state.open : state.entry * (1 + BOOK_CAP);
    return { reason: "Book Profit", why: "Full profit at +12%", price };
  }
  const armed = state.peak >= state.entry * (1 + TRAIL_ARM);
  if (armed) {
    const percentTrail = state.peak * (1 - TRAIL_GIVEBACK);
    const trail = state.ema20 != null ? Math.max(state.ema20, percentTrail) : percentTrail;
    if (state.close < trail) return { reason: "Trail", why: "Trailing stop: EMA 20 or 4.5% under the peak", price: state.close };
  } else if (state.close < state.stop || (state.ema50 != null && state.close < state.ema50)) {
    return { reason: "Exit", why: "Close lost the pullback low or EMA 50", price: state.close };
  }
  if (state.gain >= BOOK_FLOOR && state.close < state.previousClose) {
    return { reason: "Book Profit", why: "Profit booked inside the +8% to +12% band", price: state.close };
  }
  return null;
}

function niftyContext(bars: readonly PriceBar[]): NiftyContext {
  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 50) {
    // Fail closed: callers must not treat missing Nifty as green.
    return {
      ready: false,
      bars: sorted,
      regime: new Map(),
      regimeTier: new Map(),
      ema20Falling: new Map(),
      aboveEma20: new Map(),
      ret20: new Map(),
    };
  }
  const closes = sorted.map((bar) => bar.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const regime = new Map<string, boolean>();
  const regimeTier = new Map<string, "green" | "amber" | "red" | "unknown">();
  const ema20Falling = new Map<string, boolean>();
  const aboveEma20 = new Map<string, boolean>();
  sorted.forEach((bar, index) => {
    const fast = ema20[index];
    const slow = ema50[index];
    aboveEma20.set(bar.date, fast != null && bar.close > fast);
    regime.set(bar.date, fast != null && slow != null && bar.close > fast && fast > slow);
    if (fast == null || slow == null) {
      regimeTier.set(bar.date, "unknown");
      ema20Falling.set(bar.date, false);
      return;
    }
    const priorFast = index >= 5 ? ema20[index - 5] : null;
    const classified = classifyNiftyRegime({
      close: bar.close,
      ema20: fast,
      ema50: slow,
      ema20FiveSessionsAgo: priorFast,
    });
    regimeTier.set(bar.date, classified.tier);
    ema20Falling.set(bar.date, classified.ema20Falling);
  });
  const ret20 = new Map<string, number>();
  lookbackReturn(closes, RS_LOOKBACK).forEach((value, index) => {
    if (value != null) ret20.set(sorted[index].date, value);
  });
  return { ready: true, bars: sorted, regime, regimeTier, ema20Falling, aboveEma20, ret20 };
}

function refinedPullback(
  series: Prepared,
  index: number,
  market: NiftyContext,
  dailySectorScores: Map<string, Map<string, number>>,
): { ok: boolean; quality: number } | null {
  if (!market.ready) return { ok: false, quality: 0 };
  const bar = series.bars[index];
  const date = bar?.date;
  const tier = date ? market.regimeTier.get(date) : undefined;
  // Unknown, red, and a missing date all fail closed. Amber and green may enter.
  if (tier !== "green" && tier !== "amber") return { ok: false, quality: 0 };
  if (atrPercentTooHigh(bar.close, series.atr[index])) return { ok: false, quality: 0 };
  if (series.hasVolume && !primeVolumeOk(series.rvol[index])) return { ok: false, quality: 0 };
  const edge = niftyEdge(series, index, market);
  const volumeOk = !extremelyWeakVolume(series, index);
  const passed = pullbackEntryPasses(series.bars, series.ema20, series.ema50, index, edge, volumeOk, {
    version: "v1.3",
    checkVolume: true,
    rsEdge: RS_EDGE,
    atr14: series.atr[index],
    rvol: series.rvol[index],
    rsi: series.rsi[index],
  });
  const fast = series.ema20[index];
  if (!passed || edge == null || fast == null || fast <= 0) return { ok: false, quality: 0 };
  const pitSectorScore = date ? (dailySectorScores.get(date)?.get(series.security.sector) ?? null) : null;
  const quality = scoreSetupQuality({
    edge,
    rvol: series.rvol[index],
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    ema20: fast,
    ema50: series.ema50[index],
    atr14: series.atr[index],
    closeStrength: closeLocationValue(bar),
    sectorScore: pitSectorScore,
  });
  return { ok: true, quality };
}

function runDeskPortfolio(
  segment: { id: SegmentId; label: string; summary: string },
  seriesList: Prepared[],
  market: NiftyContext,
  dailySectorScores: Map<string, Map<string, number>>,
  period: BacktestPeriod,
): SegmentResult {
  const trades: BacktestTrade[] = [];
  const volumeApplied = seriesList.some((series) => series.hasVolume);
  const lastDate = seriesList.reduce((latest, series) => {
    const end = series.bars.at(-1)?.date ?? "";
    return end > latest ? end : latest;
  }, "");
  const start = lastDate ? shiftDate(lastDate, -periodLookbackDays(period)) : "";
  const byDate = new Map<string, { series: Prepared; index: number }[]>();
  for (const series of seriesList) {
    series.bars.forEach((bar, index) => {
      const row = byDate.get(bar.date) ?? [];
      row.push({ series, index });
      byDate.set(bar.date, row);
    });
  }
  const open: {
    series: Prepared;
    index: number;
    entry: number;
    peak: number;
    stop: number;
    initialStop: number;
    lastClose: number;
    grossRem: number;
    netRem: number;
    t1Booked: boolean;
    t1Price: number | null;
    t1Ret: number;
    why: string;
    sector: string;
  }[] = [];

  interface DeskPendingOrder {
    series: Prepared;
    signalIndex: number;
    stop: number;
    maxChasePrice: number;
    why: string;
    sector: string;
    quality: number;
  }
  let pendingOrders: DeskPendingOrder[] = [];
  let grossCash = 1;
  let netCash = 1;
  const grossEquityCurve: number[] = [];
  const netEquityCurve: number[] = [];

  for (const date of [...byDate.keys()].sort()) {
    const rows = byDate.get(date) ?? [];
    // Missing history and a date before EMA 50 are Unknown, not Red. Both take no new entries.
    const regimeTier = market.ready ? (market.regimeTier.get(date) ?? "unknown") : "unknown";
    const maxSlots = regimeTier === "amber" ? 3 : regimeTier === "green" ? 5 : 0;

    // 1. Morning Open Fills (09:15 AM)
    // RED / unknown: cancel pending buys (cash preservation).
    if (regimeTier === "red" || regimeTier === "unknown" || maxSlots === 0) {
      pendingOrders = [];
    } else if (pendingOrders.length > 0) {
      const startGrossEquity =
        grossCash + open.reduce((sum, p) => sum + p.grossRem * (p.lastClose / p.entry), 0);
      const startNetEquity =
        netCash + open.reduce((sum, p) => sum + p.netRem * (p.lastClose / p.entry), 0);
      const grossSlotBudget = startGrossEquity * POSITION_WEIGHT;
      const netSlotBudget = startNetEquity * POSITION_WEIGHT;

      for (const order of pendingOrders) {
        if (open.length >= maxSlots) break;
        if (open.some((position) => position.series.security.symbol === order.series.security.symbol)) continue;
        if (open.filter((position) => position.sector === order.sector).length >= MAX_PER_SECTOR) continue;

        const today = rows.find((row) => row.series.security.symbol === order.series.security.symbol);
        if (!today || today.index !== order.signalIndex + 1) continue;

        const bar = today.series.bars[today.index];
        // Gap guard: skip order if open gapped beyond max chase threshold or collapsed below stop
        if (bar.open > order.maxChasePrice || bar.open <= order.stop) continue;

        const grossAllocated = Math.min(grossCash, grossSlotBudget);
        const netAllocated = Math.min(netCash, netSlotBudget);
        if (!(grossAllocated > 0)) continue;
        grossCash -= grossAllocated;
        netCash -= netAllocated;

        // Executed at next-morning Open; start-of-day peak is bar.open (causal).
        open.push({
          series: order.series,
          index: today.index,
          entry: bar.open,
          peak: bar.open,
          stop: order.stop,
          initialStop: order.stop,
          lastClose: bar.open,
          grossRem: grossAllocated,
          netRem: netAllocated,
          t1Booked: false,
          t1Price: null,
          t1Ret: 0,
          why: `${order.why} · Next-morning open fill ${formatInr(bar.open)} (Max chase ${formatInr(order.maxChasePrice)})`,
          sector: order.sector,
        });
      }
      pendingOrders = [];
    }

    // 2. Session Trade Management & v1.4 Causal 50/50 Tranche Exits
    // Evaluate hard/protective stop FIRST against start-of-day stop; ratchet only for the NEXT session.
    for (let slot = open.length - 1; slot >= 0; slot -= 1) {
      const position = open[slot];
      const today = rows.find((row) => row.series.security.symbol === position.series.security.symbol);
      if (!today || today.index < position.index) continue;
      const bar = today.series.bars[today.index];
      const gain = bar.close / position.entry - 1;
      const held = today.index - position.index;
      const step = evaluateTrancheBarStep({
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        ema20: today.series.ema20[today.index],
        gain,
        held,
        entry: position.entry,
        stop: position.stop,
        t1Booked: position.t1Booked,
      });

      if (step.t1Fill) {
        const t1Ratio = position.entry > 0 ? step.t1Fill.price / position.entry : 1;
        const halfGross = position.grossRem * step.t1Fill.fraction;
        const halfNet = position.netRem * step.t1Fill.fraction;
        grossCash += halfGross * t1Ratio;
        netCash += halfNet * Math.max(0, t1Ratio - ROUND_TRIP_FRICTION);
        position.grossRem -= halfGross;
        position.netRem -= halfNet;
        position.t1Booked = true;
        position.t1Price = step.t1Fill.price;
        position.t1Ret = t1Ratio - 1;
      }

      if (!step.fullExit) {
        position.lastClose = bar.close;
        position.peak = Math.max(position.peak, bar.high);
        position.stop = ratchetStop(position.entry, position.peak, position.stop);
        if (position.t1Booked) {
          position.stop = Math.max(position.stop, Number((position.entry * (1 + RATCHET_FLOOR)).toFixed(2)));
        }
        continue;
      }

      const exitPrice = step.fullExit.price;
      const remRatio = position.entry > 0 ? exitPrice / position.entry : 1;
      grossCash += position.grossRem * remRatio;
      netCash += position.netRem * Math.max(0, remRatio - ROUND_TRIP_FRICTION);
      const blendedExit =
        position.t1Booked && position.t1Price != null ? 0.5 * position.t1Price + 0.5 * exitPrice : exitPrice;
      const tradeReason =
        position.t1Booked && blendedExit > position.entry ? "Book Profit" : step.fullExit.reason;
      const exitNote =
        position.t1Booked && position.t1Price != null
          ? `T1 50% booked @ ${formatInr(position.t1Price)} (+${(position.t1Ret * 100).toFixed(1)}%) · T2: ${step.fullExit.why} (${formatInr(exitPrice)})`
          : step.fullExit.why;

      if (position.series.bars[position.index].date >= start) {
        trades.push(
          makeTrade(
            position.series.security,
            position.series.bars[position.index],
            bar,
            tradeReason,
            `${position.why}. Exit: ${exitNote}`,
            blendedExit,
            position.entry,
          ),
        );
      }
      open.splice(slot, 1);
    }

    // Record daily mark-to-market equity once inside the backtest window.
    if (date >= start) {
      const eodGross =
        grossCash + open.reduce((sum, p) => sum + p.grossRem * (p.lastClose / p.entry), 0);
      const eodNet =
        netCash + open.reduce((sum, p) => sum + p.netRem * (p.lastClose / p.entry), 0);
      grossEquityCurve.push(eodGross);
      netEquityCurve.push(eodNet);
    }

    // 3. Session Close Scan & Candidate Staging (15:30 IST)
    if (date < start) continue;
    // RED / unknown: zero new setups staged for tomorrow
    if (regimeTier === "red" || regimeTier === "unknown" || maxSlots === 0) continue;

    const candidates = rows
      .flatMap((row) => {
        if (open.some((position) => position.series.security.symbol === row.series.security.symbol)) return [];
        const pitSectorScore = dailySectorScores.get(date)?.get(row.series.security.sector) ?? null;
        const live = passesLiveDeskEntry({
          bars: row.series.bars,
          ema20: row.series.ema20,
          ema50: row.series.ema50,
          index: row.index,
          relativeStrength: niftyEdge(row.series, row.index, market),
          rvol: row.series.rvol[row.index],
          atr14: row.series.atr[row.index],
          sectorScore: pitSectorScore,
          regimeTier,
          rsi: row.series.rsi[row.index],
        });
        if (!live) return [];
        const bar = row.series.bars[row.index];
        const stop = entryStop("pullback-desk", row.series, row.index);
        const atr = row.series.atr[row.index];
        const limits = chaseLimits(bar.close, stop, atr);
        return [
          {
            series: row.series,
            signalIndex: row.index,
            stop,
            maxChasePrice: limits.maxChasePrice,
            sector: row.series.security.sector,
            quality: live.quality,
            why: `${live.tier === "prime" ? "Prime" : "Standard"} trigger · quality ${live.quality.toFixed(0)}`,
          },
        ];
      })
      .sort((a, b) => b.quality - a.quality || a.series.security.symbol.localeCompare(b.series.security.symbol));

    let projectedSlots = open.length;
    const sectorCount = new Map<string, number>();
    for (const p of open) {
      sectorCount.set(p.sector, (sectorCount.get(p.sector) ?? 0) + 1);
    }
    for (const candidate of candidates) {
      if (projectedSlots >= maxSlots) break;
      const currentSectors = sectorCount.get(candidate.sector) ?? 0;
      if (currentSectors >= MAX_PER_SECTOR) continue;
      pendingOrders.push(candidate);
      projectedSlots += 1;
      sectorCount.set(candidate.sector, currentSectors + 1);
    }
  }

  for (const position of open) {
    const entryBar = position.series.bars[position.index];
    const last = position.series.bars.at(-1);
    if (last && entryBar.date >= start) {
      const mark =
        position.t1Booked && position.t1Price != null ? 0.5 * position.t1Price + 0.5 * last.close : last.close;
      const openWhy =
        position.t1Booked && position.t1Price != null
          ? `${position.why} · T1 50% booked @ ${formatInr(position.t1Price)}, T2 trailing EMA 20`
          : position.why;
      trades.push(makeTrade(position.series.security, entryBar, last, "Open", openWhy, mark, position.entry));
    }
  }
  return summarize(
    segment,
    trades.sort((a, b) => (b.exitDate ?? b.entryDate).localeCompare(a.exitDate ?? a.entryDate)),
    volumeApplied,
    {
      weightedEquity: true,
      mtmGrossEquity: trades.length > 0 ? grossEquityCurve : undefined,
      mtmNetEquity: trades.length > 0 ? netEquityCurve : undefined,
    },
  );
}

function stacked(series: Prepared, index: number): boolean {
  const close = series.bars[index]?.close;
  const fast = series.ema20[index];
  const slow = series.ema50[index];
  return close != null && fast != null && slow != null && close > fast && fast > slow;
}

function rvolFloor(id: SegmentId): number | null {
  if (id === "ema-rs-vol" || id === "full") return 1.2;
  if (id === "relaxed" || id === "sector") return 1;
  return null;
}

function sectorScore(security: ScoredSecurity): number {
  return security.factors.find((factor) => factor.key === "sector")?.value ?? 0;
}

function extended(series: Prepared, index: number, mode: "either" | "both"): boolean {
  const rsi = series.rsi[index];
  const ret5 = series.ret5[index];
  const rsiHigh = rsi != null && rsi > RSI_EXTENDED;
  const stretch = ret5 != null && ret5 > FIVE_DAY_EXTENDED;
  return mode === "both" ? rsiHigh && stretch : rsiHigh || stretch;
}

function relativeStrength(series: Prepared, index: number, benchmark: Map<string, number>): number | null {
  const date = series.bars[index]?.date;
  const stock = date ? series.ret20.get(date) : undefined;
  const book = date ? benchmark.get(date) : undefined;
  if (stock == null || book == null || 1 + book <= 0) return null;
  return (1 + stock) / (1 + book) - 1;
}

function makeTrade(
  security: ScoredSecurity,
  entryBar: PriceBar,
  exitBar: PriceBar,
  reason: string,
  why: string,
  customExitPrice?: number,
  customEntryPrice?: number,
): BacktestTrade {
  const exit = customExitPrice ?? exitBar.close;
  const entry = customEntryPrice ?? entryBar.close;
  const returnPct = entry > 0 ? exit / entry - 1 : 0;
  const open = reason === "Open";
  return {
    symbol: security.symbol,
    name: security.name,
    entryDate: entryBar.date,
    exitDate: open ? null : exitBar.date,
    entry,
    exit,
    returnPct,
    holdDays: open ? 0 : calendarDays(entryBar.date, exitBar.date),
    result: open ? "Open" : returnPct >= 0 ? "Win" : "Loss",
    reason,
    why,
  };
}

function summarize(
  segment: { id: SegmentId; label: string; summary: string },
  trades: BacktestTrade[],
  volumeApplied: boolean,
  options: {
    weightedEquity?: boolean;
    mtmGrossEquity?: readonly number[];
    mtmNetEquity?: readonly number[];
  } = {},
): SegmentResult {
  const closed = trades.filter((trade) => trade.result !== "Open");
  const winners = closed.filter((trade) => trade.returnPct > 0);
  const losers = closed.filter((trade) => trade.returnPct < 0);
  const averageWinner = mean(winners.map((trade) => trade.returnPct));
  const averageLoser = mean(losers.map((trade) => trade.returnPct));
  const winRate = closed.length > 0 ? winners.length / closed.length : null;
  const grossWin = winners.reduce((sum, trade) => sum + trade.returnPct, 0);
  const grossLoss = Math.abs(losers.reduce((sum, trade) => sum + trade.returnPct, 0));
  let streak = 0;
  let maxConsecutiveLosses = 0;
  for (const trade of [...closed].sort((a, b) => a.exitDate!.localeCompare(b.exitDate!))) {
    if (trade.returnPct < 0) {
      streak += 1;
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, streak);
    } else {
      streak = 0;
    }
  }
  const ordered = [...closed].sort((a, b) => a.exitDate!.localeCompare(b.exitDate!) || a.entryDate.localeCompare(b.entryDate));
  const returns = ordered.map((trade) => trade.returnPct);
  const netReturns = returns.map((value) => value - ROUND_TRIP_FRICTION);
  // Exact arithmetic mean over all closed trades (handles breakeven 0% trades accurately).
  const expectancy = closed.length === 0 ? null : returns.reduce((sum, value) => sum + value, 0) / closed.length;
  // Desk book uses daily mark-to-market portfolio equity when available; uncapped segments use closed-trade compounding.
  const weight = options.weightedEquity ? POSITION_WEIGHT : 1;
  const hasMtm = options.mtmGrossEquity != null && options.mtmGrossEquity.length > 0;
  const totalReturn = hasMtm
    ? (options.mtmGrossEquity![options.mtmGrossEquity!.length - 1] ?? 1) - 1
    : closed.length > 0
      ? returns.reduce((equity, value) => equity * (1 + weight * value), 1) - 1
      : 0;
  const netTotalReturn =
    options.mtmNetEquity != null && options.mtmNetEquity.length > 0
      ? (options.mtmNetEquity[options.mtmNetEquity.length - 1] ?? 1) - 1
      : closed.length > 0
        ? netReturns.reduce((equity, value) => equity * (1 + weight * value), 1) - 1
        : 0;
  const netWinners = netReturns.filter((value) => value > 0);
  const netLosers = netReturns.filter((value) => value < 0);
  const netGrossWin = netWinners.reduce((sum, value) => sum + value, 0);
  const netGrossLoss = Math.abs(netLosers.reduce((sum, value) => sum + value, 0));
  const netExpectancy = closed.length === 0 ? null : netReturns.reduce((sum, value) => sum + value, 0) / closed.length;
  return {
    id: segment.id,
    label: segment.label,
    summary: segment.summary,
    trades,
    closed: closed.length,
    open: trades.length - closed.length,
    winRate,
    averageWinner,
    averageLoser,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    expectancy,
    netProfitFactor: netGrossLoss > 0 ? netGrossWin / netGrossLoss : null,
    netExpectancy,
    maxDrawdown: hasMtm ? drawdownFromEquityCurve(options.mtmGrossEquity!) : maxDrawdown(returns, POSITION_WEIGHT),
    netMaxDrawdown:
      options.mtmNetEquity != null && options.mtmNetEquity.length > 0
        ? drawdownFromEquityCurve(options.mtmNetEquity)
        : maxDrawdown(netReturns, POSITION_WEIGHT),
    averageHoldDays: mean(closed.map((trade) => trade.holdDays)),
    maxConsecutiveLosses,
    totalReturn,
    netTotalReturn,
    volumeApplied,
  };
}

function drawdownFromEquityCurve(curve: readonly number[]): number | null {
  if (curve.length === 0) return null;
  let peak = 1;
  let worst = 0;
  for (const equity of curve) {
    peak = Math.max(peak, equity);
    worst = Math.max(worst, peak > 0 ? (peak - equity) / peak : 0);
  }
  return worst;
}

function maxDrawdown(returns: readonly number[], weight: number): number | null {
  if (returns.length === 0) return null;
  let equity = 1;
  let peak = 1;
  let worst = 0;
  for (const value of returns) {
    equity *= 1 + weight * value;
    peak = Math.max(peak, equity);
    worst = Math.max(worst, peak > 0 ? (peak - equity) / peak : 0);
  }
  return worst;
}

function calendarDays(start: string, end: string): number {
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

function prepare(securities: readonly ScoredSecurity[], histories: Record<string, PriceBar[]>): Prepared[] {
  return securities.flatMap((security) => {
    const bars = [...(histories[security.symbol] ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    if (bars.length < 50) return [];
    const closes = bars.map((bar) => bar.close);
    return [
      {
        security,
        bars,
        ema20: ema(closes, 20),
        ema50: ema(closes, 50),
        rsi: wilderRsi(closes, RSI_PERIOD),
        atr: atrWilder(bars, 14),
        ret5: lookbackReturn(closes, 5),
        ret20: new Map(
          lookbackReturn(closes, RS_LOOKBACK).flatMap((value, index) =>
            value == null ? [] : [[bars[index].date, value] as const],
          ),
        ),
        rvol: bars.map((_, index) => relativeVolumeAt(bars, index, RVOL_LOOKBACK)),
        hasVolume: bars.some((bar) => (bar.volume ?? 0) > 0),
      },
    ];
  });
}

/**
 * Point-in-time sector strength (0–100) for every date and sector, computed strictly
 * from bars up to that date (20d peer return vs universe + % of sector constituents above EMA 20).
 * Eliminates look-ahead bias from using today's sector factor on historical backtest dates.
 */
function buildDailySectorScores(seriesList: Prepared[]): Map<string, Map<string, number>> {
  const perDate = new Map<
    string,
    {
      universeRetSum: number;
      universeRetCount: number;
      sectors: Map<string, { retSum: number; retCount: number; aboveCount: number; trendCount: number }>;
    }
  >();

  for (const series of seriesList) {
    const sector = series.security.sector;
    for (let i = 0; i < series.bars.length; i += 1) {
      const bar = series.bars[i];
      const date = bar.date;
      let bucket = perDate.get(date);
      if (!bucket) {
        bucket = { universeRetSum: 0, universeRetCount: 0, sectors: new Map() };
        perDate.set(date, bucket);
      }
      let sectorStat = bucket.sectors.get(sector);
      if (!sectorStat) {
        sectorStat = { retSum: 0, retCount: 0, aboveCount: 0, trendCount: 0 };
        bucket.sectors.set(sector, sectorStat);
      }
      const ret = series.ret20.get(date);
      if (ret != null) {
        bucket.universeRetSum += ret;
        bucket.universeRetCount += 1;
        sectorStat.retSum += ret;
        sectorStat.retCount += 1;
      }
      const fast = series.ema20[i];
      if (fast != null) {
        sectorStat.trendCount += 1;
        if (bar.close >= fast) sectorStat.aboveCount += 1;
      }
    }
  }

  const out = new Map<string, Map<string, number>>();
  for (const [date, bucket] of perDate) {
    if (bucket.universeRetCount === 0) continue;
    const universeAvg = bucket.universeRetSum / bucket.universeRetCount;
    const scores = new Map<string, number>();
    for (const [sector, stat] of bucket.sectors) {
      if (stat.retCount === 0) continue;
      const sectorAvg = stat.retSum / stat.retCount;
      const breadth = stat.trendCount > 0 ? stat.aboveCount / stat.trendCount : null;
      const score = computeSectorStrengthScore(sectorAvg, universeAvg, breadth);
      if (score != null) scores.set(sector, score);
    }
    if (scores.size > 0) out.set(date, scores);
  }
  return out;
}

function benchmarkReturns(seriesList: Prepared[]): Map<string, number> {
  const grouped = new Map<string, number[]>();
  for (const series of seriesList) {
    for (const [date, value] of series.ret20) {
      const row = grouped.get(date) ?? [];
      row.push(value);
      grouped.set(date, row);
    }
  }
  const benchmark = new Map<string, number>();
  for (const [date, values] of grouped) {
    if (values.length < 2) continue;
    benchmark.set(date, values.reduce((sum, value) => sum + value, 0) / values.length);
  }
  return benchmark;
}

function lookbackReturn(closes: number[], lookback: number): (number | null)[] {
  return closes.map((close, index) => {
    const base = closes[index - lookback];
    if (index < lookback || base == null || base <= 0) return null;
    return close / base - 1;
  });
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function signedPct(value: number): string {
  const text = `${(Math.abs(value) * 100).toFixed(1)}%`;
  return value >= 0 ? `+${text}` : `−${text}`;
}

function shiftDate(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

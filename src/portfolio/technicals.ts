import { formatInr, type PriceBar, ema } from "../analysis";
import { relativeVolumeAt } from "../analysis/indicators";
import { wilderRsi } from "../strategy/pullback";
import { rsVersusNifty } from "../recommendations/setup";
import { evaluatePositionSignal, profitTargetPrice, PROTECT_GAIN } from "../strategy/policy";
import type { TranchePlan } from "./liveBook";

export type ActionVerdict = "HOLD" | "AVERAGE" | "SELL" | "TRIM";

export interface TechnicalAnalysisSummary {
  verdict: ActionVerdict;
  verdictLabel: string;
  verdictTone: "strong" | "watch" | "weak";
  summary: string;
  rationale: string;
  trendStatus: string;
  trendTone: "strong" | "watch" | "weak";
  rsi: number | null;
  rsiLabel: string;
  rsiTone: "strong" | "watch" | "weak";
  relativeStrengthPct: number | null;
  rsLabel: string;
  rsTone: "strong" | "watch" | "weak";
  rvol: number | null;
  volumeLabel: string;
  volumeTone: "strong" | "watch" | "weak";
  support: number;
  resistance: number;
  ema20: number | null;
  ema50: number | null;
  stopLevel: number | null;
  targetLevel: number | null;
  distanceToEma20Pct: number | null;
  favorableToAverage: boolean;
}

export function evaluatePortfolioTechnicals(input: {
  symbol?: string;
  entry: number;
  quantity: number;
  lastClose: number;
  ema20: number | null;
  bars?: readonly PriceBar[];
  niftyBars?: readonly PriceBar[];
  initialStopLoss?: number | null;
  entryDate?: string | null;
  tranchePlan?: TranchePlan;
  t1Booked?: boolean;
}): TechnicalAnalysisSummary {
  const { entry, quantity, lastClose, ema20, bars: rawBars, niftyBars, initialStopLoss, entryDate, tranchePlan, t1Booked } = input;
  const bars = rawBars && rawBars.length > 0 ? [...rawBars].sort((a, b) => a.date.localeCompare(b.date)) : undefined;

  const closes = bars && bars.length >= 20 ? bars.map((b) => b.close) : [];
  const ema50Series = closes.length >= 50 ? ema(closes, 50) : [];
  const ema50 = ema50Series.length > 0 ? ema50Series[ema50Series.length - 1] : null;

  // 1. RSI (14)
  const rsiSeries = closes.length >= 15 ? wilderRsi(closes, 14) : [];
  const rsiRaw = rsiSeries.length > 0 ? rsiSeries[rsiSeries.length - 1] : null;
  const rsi = rsiRaw != null ? Math.round(rsiRaw * 10) / 10 : null;
  let rsiLabel = "Neutral";
  let rsiTone: "strong" | "watch" | "weak" = "watch";
  if (rsi != null) {
    if (rsi >= 72) {
      rsiLabel = "Overbought (RSI > 72)";
      rsiTone = "watch";
    } else if (rsi >= 50) {
      rsiLabel = "Bullish Momentum (RSI 50-70)";
      rsiTone = "strong";
    } else if (rsi >= 38) {
      rsiLabel = "Pullback / Support Zone (RSI 38-50)";
      rsiTone = "watch";
    } else {
      rsiLabel = "Oversold (RSI < 38)";
      rsiTone = "weak";
    }
  }

  // 2. Relative Strength vs Nifty 50
  const rsEdge = bars && niftyBars && bars.length >= 21 && niftyBars.length >= 21 ? rsVersusNifty(bars, niftyBars) : null;
  const relativeStrengthPct = rsEdge != null ? Math.round(rsEdge * 1000) / 10 : null;
  let rsLabel = "In Line with Market";
  let rsTone: "strong" | "watch" | "weak" = "watch";
  if (relativeStrengthPct != null) {
    if (relativeStrengthPct >= 3.0) {
      rsLabel = `Outperforming Nifty (+${relativeStrengthPct}%)`;
      rsTone = "strong";
    } else if (relativeStrengthPct > 0) {
      rsLabel = `Mild Outperformance (+${relativeStrengthPct}%)`;
      rsTone = "strong";
    } else {
      rsLabel = `Lagging Nifty (${relativeStrengthPct}%)`;
      rsTone = "weak";
    }
  }

  // 3. Volume Profile (RVOL)
  const rvolRaw = bars && bars.length >= 21 ? relativeVolumeAt(bars, bars.length - 1) : null;
  const rvol = rvolRaw != null ? Math.round(rvolRaw * 100) / 100 : null;
  let volumeLabel = "Average Volume";
  let volumeTone: "strong" | "watch" | "weak" = "watch";
  if (rvol != null) {
    if (rvol >= 1.5) {
      volumeLabel = `Heavy Volume (${rvol}x avg)`;
      volumeTone = "watch";
    } else if (rvol <= 0.85) {
      volumeLabel = `Quiet / Low Volume (${rvol}x avg)`;
      volumeTone = "strong";
    } else {
      volumeLabel = `Normal Turnover (${rvol}x avg)`;
      volumeTone = "watch";
    }
  }

  // 4. Support and Resistance Levels
  let support = ema20 != null && ema20 > 0 ? ema20 : lastClose * 0.95;
  let resistance = lastClose * 1.08;
  if (bars && bars.length >= 20) {
    const recent = bars.slice(-25);
    const recentLows = recent.map((b) => b.low);
    const recentHighs = recent.map((b) => b.high);
    const minLow = Math.min(...recentLows);
    const maxHigh = Math.max(...recentHighs);
    support = ema20 != null && ema20 > 0 && Math.abs(lastClose - ema20) / lastClose < 0.08 ? ema20 : minLow;
    resistance = maxHigh > lastClose ? maxHigh : lastClose * 1.08;
  }

  // 5. Trend Structure
  let trendStatus = "Trend Neutral";
  let trendTone: "strong" | "watch" | "weak" = "watch";
  const isAboveEma20 = ema20 != null && lastClose >= ema20;
  const isAboveEma50 = ema50 != null && lastClose >= ema50;
  const isEmaBullish = ema20 != null && ema50 != null && ema20 >= ema50;

  if (isAboveEma20 && isAboveEma50 && isEmaBullish) {
    trendStatus = "Strong Uptrend (Above EMA 20 & 50)";
    trendTone = "strong";
  } else if (isAboveEma20) {
    trendStatus = "Holding EMA 20 Support";
    trendTone = "strong";
  } else if (!isAboveEma20 && isAboveEma50) {
    trendStatus = "Below EMA 20 · Testing EMA 50";
    trendTone = "watch";
  } else {
    trendStatus = "Downtrend / Below EMA 20 & 50";
    trendTone = "weak";
  }

  const gain = entry > 0 ? (lastClose - entry) / entry : 0;
  const distanceToEma20Pct = ema20 != null && ema20 > 0 ? Math.round(((lastClose - ema20) / ema20) * 1000) / 10 : null;

  // Stops and targets (aligned with policy: max of +12% and 1.8R)
  const stopLevel = tranchePlan?.runnerStopLevel ?? initialStopLoss ?? (ema20 != null ? ema20 * 0.98 : entry * 0.95);
  const rawTarget = entry > 0 ? profitTargetPrice(entry, initialStopLoss ?? null) : lastClose * 1.12;
  const targetLevel = Number(rawTarget.toFixed(2));

  // 6. ACTION VERDICT — hard exits follow shared policy. A target signal is a full-exit prompt, not a partial. RSI is advisory only.
  const policy = evaluatePositionSignal({
    lastClose,
    ema20,
    entry,
    bars,
    initialStopLoss,
    entryDate,
    t1Booked,
  });

  if (policy.id === "exit") {
    return {
      verdict: "SELL",
      verdictLabel: "SELL / EXIT NOW",
      verdictTone: "weak",
      summary: policy.reason,
      rationale: `Exit all ${quantity} shares. Live stops are checked on the close. Do not average down through the stop or EMA 20.`,
      trendStatus,
      trendTone,
      rsi,
      rsiLabel,
      rsiTone,
      relativeStrengthPct,
      rsLabel,
      rsTone,
      rvol,
      volumeLabel,
      volumeTone,
      support,
      resistance,
      ema20,
      ema50,
      stopLevel,
      targetLevel,
      distanceToEma20Pct,
      favorableToAverage: false,
    };
  }

  const isParabolicRsi = rsi != null && rsi >= 78;
  if (policy.id === "book" || tranchePlan?.t1.action === "book") {
    const t1Qty = Math.max(1, Math.ceil(quantity / 2));
    const t2Qty = Math.max(0, quantity - t1Qty);
    return {
      verdict: "TRIM",
      verdictLabel: "Book 50% (T1 +6%)",
      verdictTone: "strong",
      summary: `Policy signal: ${policy.reason} Open +${(gain * 100).toFixed(1)}%.`,
      rationale: `Book ${t1Qty} shares (T1) to lock gain, move protective stop to entry +1.5%, and trail remaining ${t2Qty} shares (T2) freely on EMA 20 with no +12% cap.`,
      trendStatus,
      trendTone,
      rsi,
      rsiLabel,
      rsiTone,
      relativeStrengthPct,
      rsLabel,
      rsTone,
      rvol,
      volumeLabel,
      volumeTone,
      support,
      resistance,
      ema20,
      ema50,
      stopLevel: tranchePlan?.runnerStopLevel ?? entry,
      targetLevel,
      distanceToEma20Pct,
      favorableToAverage: false,
    };
  }

  if (isParabolicRsi && gain >= PROTECT_GAIN) {
    return {
      verdict: "TRIM",
      verdictLabel: "Suggestion · extended RSI",
      verdictTone: "watch",
      summary: `Advisory only: RSI ${rsi} is extended while open +${(gain * 100).toFixed(1)}%. Not a hard policy exit.`,
      rationale: `Optional review while still above EMA 20. Hard rules remain: close through the stop, close under the runner or EMA 20, the full target, or a red/heavy down close after +${(PROTECT_GAIN * 100).toFixed(0)}%.`,
      trendStatus,
      trendTone,
      rsi,
      rsiLabel,
      rsiTone,
      relativeStrengthPct,
      rsLabel,
      rsTone,
      rvol,
      volumeLabel,
      volumeTone,
      support,
      resistance,
      ema20,
      ema50,
      stopLevel,
      targetLevel,
      distanceToEma20Pct,
      favorableToAverage: false,
    };
  }

  // Case C: AVERAGE / ACCUMULATE (BUY DIP)
  // Conditions:
  // 1. Trend intact: lastClose >= ema20
  // 2. Testing pullback support: low or close is within 2.5% of EMA 20 (low <= ema20 * 1.025)
  // 3. Calm volume: rvol <= 1.25 (no institutional distribution)
  // 4. Position PnL is between -4.5% and +3.0% (prime dip zone to improve cost basis)
  // 5. RSI is not overbought: rsi < 65
  const isTrendIntact = ema50 == null || (ema20 != null && ema20 >= ema50 && lastClose >= ema50);
  const isTestingEmaDip =
    ema20 != null &&
    lastClose >= ema20 &&
    (distanceToEma20Pct != null && distanceToEma20Pct <= 2.5);
  const isCalmVolume = rvol == null || rvol <= 1.25;
  const isHealthyRsi = rsi == null || rsi <= 65;
  const isFavorableCostBasis = gain >= -0.05 && gain <= 0.03;
  const isRsAcceptable = relativeStrengthPct == null || relativeStrengthPct >= -1.5;

  if (isTrendIntact && isTestingEmaDip && isCalmVolume && isHealthyRsi && isFavorableCostBasis && isRsAcceptable) {
    return {
      verdict: "AVERAGE",
      verdictLabel: "ACCUMULATE / AVERAGE DIP",
      verdictTone: "strong",
      summary: `Clean pullback retest holding EMA 20 (${formatInr(ema20!)}). Low volume consolidation in active uptrend.`,
      rationale: `Favourable risk-to-reward to add 25%–50% quantity. Keep stop strictly below EMA 20 (${formatInr(ema20! * 0.985)}). Target: ${formatInr(targetLevel)}.`,
      trendStatus,
      trendTone,
      rsi,
      rsiLabel,
      rsiTone,
      relativeStrengthPct,
      rsLabel,
      rsTone,
      rvol,
      volumeLabel,
      volumeTone,
      support,
      resistance,
      ema20,
      ema50,
      stopLevel,
      targetLevel,
      distanceToEma20Pct,
      favorableToAverage: true,
    };
  }

  // Case D: HOLD TREND (Default healthy riding position)
  return {
    verdict: "HOLD",
    verdictLabel: "HOLD TREND",
    verdictTone: "strong",
    summary: `Trend is healthy above EMA 20 (${ema20 ? formatInr(ema20) : "n/a"}). Open P&L is ${(gain * 100).toFixed(1)}%.`,
    rationale: `No exit or trimming rules triggered. Maintain position and trail along EMA 20 for target at ${formatInr(targetLevel)}.`,
    trendStatus,
    trendTone,
    rsi,
    rsiLabel,
    rsiTone,
    relativeStrengthPct,
    rsLabel,
    rsTone,
    rvol,
    volumeLabel,
    volumeTone,
    support,
    resistance,
    ema20,
    ema50,
    stopLevel,
    targetLevel,
    distanceToEma20Pct,
    favorableToAverage: false,
  };
}

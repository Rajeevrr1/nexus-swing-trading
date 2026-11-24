import { ema, formatInr, type PriceBar } from "../analysis";
import { closeLocationValue, relativeVolumeAt } from "../analysis/indicators";
import { evaluateMarketRegime, type MarketRegimeStatus, type MarketRegimeTier } from "../market/status";
import {
  computePositionSizing,
  scaleForSectorOverlap,
  type PositionSizingResult,
} from "../risk/positionSizing";
import { loadRiskSettings } from "../risk/settings";
import type { ScoredSecurity } from "../scanner";
import {
  classifyTriggerTier,
  continuationTraitCount,
  CONTINUATION_SPREAD_MAX,
  effectivePullbackBand,
  emaNotFalling,
  emaSpreadRatio,
  isCapitulationCandle,
  isExtendedMove,
  PRIME_SECTOR_MIN,
  PULLBACK_BAND,
  RS_EDGE,
  RSI_EXTENDED,
  RVOL_FLOOR,
  STANDARD_TRAIT_MIN,
  standardContinuationPasses,
  taggedPullbackGeometry,
  wilderRsi,
  YOUNG_SPREAD_MAX,
  type TriggerTier,
} from "../strategy/pullback";
import {
  ALLOW_STANDARD_DESK_ENTRIES,
  allowNewEntry,
  profitTargetPrice,
  riskScaleForRegime,
  TRANCHE_T1_GAIN,
} from "../strategy/policy";
import { atrWilder } from "../analysis/indicators";
import type { RiskCapitalSettings } from "../risk/settings";

/** At or above this, volume is fine, including a slightly quiet session. */
const RVOL_FINE = 0.85;
/** Standard only. Prime is not gated by this score. */
const STANDARD_QUALITY_MIN = 50;

export type VolumeRead = "fine" | "moderate" | "weak" | "unknown";
export type ActionBucket = "gtt" | "near" | "lagging";

export interface SwingSetup {
  pullback: boolean;
  relativeStrength: number | null;
  outperforms: boolean;
  extended: boolean;
  volume: VolumeRead;
  /** Prime or standard trigger that also clears the turnover floor. */
  pullbackSwing: boolean;
  triggerTier: TriggerTier | null;
  /** Watch ranking only. Active triggers leave this empty. */
  actionBucket: ActionBucket | null;
  emaSpreadPct: number | null;
  rvol: number | null;
  risingEma20: boolean;
  /** Active trigger, or a sized watch reference when today is not an entry. */
  setupState: "active" | "watch" | "idle";
  priority: number;
  quality: number | null;
  confidence: "High" | "Solid" | "Fair" | null;
  niftyAbove: boolean | null;
  marketRegime: MarketRegimeStatus | null;
  closeStrength: number | null;
  lowDistance: number | null;
  action: string | null;
  /** Short blocker or dip price for a watch. Null on an active trigger. */
  triggerHint: string | null;
  watchReason: string | null;
  /** Top of the 3.5% pullback zone: EMA 20 × 1.035. A GTT limit can sit here. */
  buyZoneTop: number | null;
  /** Tightest next-morning chase: 0.35×ATR, 1.2% above entry, or +20% of initial risk. */
  maxChasePrice: number | null;
  /** Reward to the target (max of +12% and 1.8R) divided by the initial stop distance. */
  riskRewardTo12Pct: number | null;
  /** v1.4 Tranche 1 lock price: entry × 1.06 (+6%, book 50% shares). */
  t1TargetPrice: number | null;
  targetPrice: number | null;
  entryPrice: number | null;
  initialStopLoss: number | null;
  atr14: number | null;
  suggestedQty: number | null;
  capitalUsed: number | null;
  sizing: PositionSizingResult | null;
}

const EMPTY: SwingSetup = {
  pullback: false,
  relativeStrength: null,
  outperforms: false,
  extended: false,
  volume: "unknown",
  pullbackSwing: false,
  triggerTier: null,
  actionBucket: null,
  emaSpreadPct: null,
  rvol: null,
  risingEma20: false,
  setupState: "idle",
  priority: 0,
  quality: null,
  confidence: null,
  niftyAbove: null,
  marketRegime: null,
  closeStrength: null,
  lowDistance: null,
  action: null,
  triggerHint: null,
  watchReason: null,
  buyZoneTop: null,
  maxChasePrice: null,
  riskRewardTo12Pct: null,
  t1TargetPrice: null,
  targetPrice: null,
  entryPrice: null,
  initialStopLoss: null,
  atr14: null,
  suggestedQty: null,
  capitalUsed: null,
  sizing: null,
};

/** Open-book inputs for the next executable trigger. Watches ignore these. */
export interface SwingSizingContext {
  openRiskRupees?: number;
  openSectors?: ReadonlySet<string>;
  sector?: string | null;
  /** Optional live intraday price (e.g. next-morning quote) checked against maxChasePrice. */
  livePrice?: number | null;
}

/** Sector factor used by the Prime gate. Missing means Prime cannot clear 55. */
export function sectorStrength(security: { factors: readonly { key: string; value: number }[] }): number | null {
  return security.factors.find((factor) => factor.key === "sector")?.value ?? null;
}

/**
 * Prime needs sector strength of at least 55.
 * Below that, or when the score was not supplied, the name is retried as Standard.
 * Standard and non-triggers are unchanged.
 */
export function applyPrimeSectorGate(
  tier: TriggerTier | null,
  sectorScore: number | null | undefined,
  standardStillPasses: boolean,
): TriggerTier | null {
  if (tier !== "prime") return tier;
  if (sectorScore != null && sectorScore >= PRIME_SECTOR_MIN) return "prime";
  return standardStillPasses ? "standard" : null;
}

/**
 * Scale the classified tier. A regime block must not be passed as null:
 * null on Amber is 0.5×, which is the Prime scale, not a blocked Standard.
 */
export function riskScaleForSetup(
  regimeTier: MarketRegimeTier,
  classifiedTier: TriggerTier | null,
  ema20Falling: boolean,
): number {
  return riskScaleForRegime(regimeTier, classifiedTier, { ema20Falling });
}

/** Latest daily bar versus Nifty — live v1.3 pullback + RS. */
export function evaluateSwingSetup(
  bars: readonly PriceBar[],
  nifty: readonly PriceBar[],
  sectorScore?: number | null,
  riskSettings?: RiskCapitalSettings,
  sizingContext?: SwingSizingContext,
): SwingSetup {
  const series = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  const index = series.length - 1;
  if (index < 50) return EMPTY;
  const closes = series.map((bar) => bar.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const atr14Now = atrWilder(series, 14)[index];
  const rsiNow = wilderRsi(closes, 14)[index];
  const pullback = taggedPullbackGeometry(series, ema20, ema50, index, PULLBACK_BAND, atr14Now);
  const relativeStrength = niftyEdge(series, index, nifty);
  const outperforms = relativeStrength != null && relativeStrength >= RS_EDGE;
  const extended = isExtendedMove(closes, index, rsiNow);
  const volume = volumeRead(series, index);
  const volumeOk = volume !== "weak";
  const bar = series[index];
  const rising = emaNotFalling(ema20, index);
  const capitulation = isCapitulationCandle(bar, atr14Now);
  const rvol = relativeVolumeAt(series, index);
  let tier = classifyTriggerTier(series, ema20, ema50, index, relativeStrength, volumeOk, rvol, atr14Now, rsiNow);
  tier = applyPrimeSectorGate(
    tier,
    sectorScore,
    standardContinuationPasses(series, ema20, ema50, index, relativeStrength, volumeOk, rvol, atr14Now, rsiNow),
  );
  const turnover = averageDailyTurnover(series, index);
  const liquid = turnover != null && turnover >= MIN_AVG_TURNOVER;
  const fast = ema20[index];
  const spreadRatio = emaSpreadRatio(fast, ema50[index]);
  const closeStrength = closeLocationValue(bar);
  const lowDistance = fast != null && fast > 0 ? bar.low / fast - 1 : 0.035;
  const regime = evaluateMarketRegime(nifty);
  const niftyAbove =
    regime.tier === "green" ||
    (regime.niftyClose != null && regime.ema20 != null && regime.niftyClose > regime.ema20);

  // Unknown/red block all. Amber allows Prime only. Green allows both.
  const tierAllowedByRegime = allowNewEntry(regime.tier, tier) ? tier : null;
  let pullbackSwing = tierAllowedByRegime != null && liquid;

  const uptrend = fast != null && ema50[index] != null && fast > ema50[index]! && bar.close > ema50[index]!;
  const rawQuality =
    fast != null && relativeStrength != null
      ? scoreSetupQuality({
          edge: relativeStrength,
          rvol,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          ema20: fast,
          ema50: ema50[index],
          atr14: atr14Now,
          closeStrength,
          sectorScore,
        })
      : null;
  const quality = capDisplayedQuality(rawQuality, relativeStrength, uptrend);
  // Standard needs a quality score of at least 50. Prime is unchanged.
  const qualityBlocked =
    tierAllowedByRegime === "standard" && (quality == null || quality < STANDARD_QUALITY_MIN);
  if (qualityBlocked) pullbackSwing = false;
  const settings = riskSettings ?? loadRiskSettings();
  // Classified tier, not the regime-cleared tier. Amber Standard is 0×, not the null-tier 0.5×.
  let riskScale = riskScaleForSetup(regime.tier, tier, regime.ema20Falling);
  const sectorAlreadyOpen = Boolean(
    pullbackSwing && sizingContext?.sector && sizingContext.openSectors?.has(sizingContext.sector),
  );
  riskScale = scaleForSectorOverlap(riskScale, sectorAlreadyOpen);
  const maxOpenRisk = settings.totalCapital * (settings.maxTotalOpenRiskPercent / 100);
  const remainingOpenRisk = pullbackSwing
    ? Math.max(0, maxOpenRisk - (sizingContext?.openRiskRupees ?? 0))
    : undefined;
  const sizing = computePositionSizing(
    series,
    settings,
    riskScale,
    remainingOpenRisk == null ? undefined : { remainingOpenRisk },
  );
  const entryPrice = sizing?.entryPrice ?? bar.close;
  const initialStopLoss = sizing?.initialStopLoss ?? null;
  const adaptiveBand = effectivePullbackBand(bar.close, atr14Now, PULLBACK_BAND);
  const buyZoneTop = fast != null && fast > 0 ? Number((fast * (1 + adaptiveBand)).toFixed(2)) : null;
  const chase = entryPrice != null ? chaseLimits(entryPrice, initialStopLoss, atr14Now) : null;
  // Gap guard: compare a live quote (e.g. next-morning print) against the signal bar's max chase.
  // Never compare bar.open against bar.close of the same bar — that would falsely reject red pullbacks!
  const liveQuote = sizingContext?.livePrice;
  const gappedBeyondChase =
    pullbackSwing &&
    chase != null &&
    liveQuote != null &&
    Number.isFinite(liveQuote) &&
    Math.abs(liveQuote - bar.close) > 0.009 &&
    liveQuote > chase.maxChasePrice;
  if (gappedBeyondChase) pullbackSwing = false;
  const setupState: SwingSetup["setupState"] = pullbackSwing ? "active" : sizing ? "watch" : "idle";
  const actionBucket = pullbackSwing
    ? null
    : gappedBeyondChase
      ? "gtt"
      : watchBucket(bar, series, index, fast, ema50[index], spreadRatio, relativeStrength, rvol, adaptiveBand);
  const hint = pullbackSwing
    ? null
    : qualityBlocked
      ? `Quality ${quality ?? "—"} is below ${STANDARD_QUALITY_MIN} · Standard stays a watch`
      : gappedBeyondChase && chase && liveQuote != null
        ? `Live price ${formatInr(liveQuote)} is above max chase ${formatInr(chase.maxChasePrice)} · not executable (GTT only)`
        : watchHint({
        bar,
        bars: series,
        index,
        closes,
        ema20: fast,
        ema50: ema50[index],
        spread: spreadRatio,
        relativeStrength,
        rvol,
        extended,
        traits: continuationTraitCount(bar, fast, rvol),
        tier,
        liquid,
        buyZoneTop,
        bucket: actionBucket,
        regime,
      });
  return {
    pullback,
    relativeStrength,
    outperforms,
    extended,
    volume,
    pullbackSwing,
    triggerTier: pullbackSwing ? tierAllowedByRegime : null,
    actionBucket,
    emaSpreadPct: spreadRatio == null ? null : spreadRatio * 100,
    rvol,
    risingEma20: rising,
    setupState,
    priority: pullbackSwing ? (tierAllowedByRegime === "prime" ? 3 : 2) : actionBucket === "gtt" ? 1 : actionBucket === "near" ? 0 : -1,
    quality,
    confidence: quality == null ? null : quality >= 70 ? "High" : quality >= 55 ? "Solid" : "Fair",
    niftyAbove,
    marketRegime: regime,
    closeStrength,
    lowDistance,
    action: pullbackSwing
      ? actionFor({
          pullback,
          tier: tierAllowedByRegime,
          liquid,
          outperforms,
          extended,
          volume,
          rising,
          capitulation,
          niftyAbove,
          regime,
          closeStrength,
          traits: continuationTraitCount(bar, fast, rvol),
          spreadPct: spreadRatio == null ? null : spreadRatio * 100,
        })
      : hint,
    triggerHint: hint,
    watchReason: hint,
    buyZoneTop,
    maxChasePrice: pullbackSwing || gappedBeyondChase ? (chase?.maxChasePrice ?? null) : null,
    riskRewardTo12Pct: pullbackSwing ? (chase?.riskRewardTo12Pct ?? null) : null,
    t1TargetPrice:
      entryPrice != null && entryPrice > 0
        ? Number((entryPrice * (1 + TRANCHE_T1_GAIN)).toFixed(2))
        : null,
    targetPrice: pullbackSwing ? (chase?.targetPrice ?? null) : null,
    entryPrice,
    initialStopLoss,
    atr14: sizing?.atr14 ?? null,
    // Watches, regime blocks, and quality blocks do not show a share count.
    suggestedQty: pullbackSwing ? (sizing?.suggestedQty ?? 0) : null,
    capitalUsed: pullbackSwing ? (sizing?.capitalUsed ?? 0) : null,
    sizing: pullbackSwing || sizing == null ? sizing : { ...sizing, suggestedQty: 0, capitalUsed: 0 },
  };
}

export function triggerBadgeClass(tier: TriggerTier | null, bucket: ActionBucket | null = null): string {
  if (tier === "prime") return "setup-badge is-prime";
  if (tier === "standard") return "setup-badge is-standard";
  if (bucket === "gtt") return "setup-badge is-gtt";
  if (bucket === "near") return "setup-badge is-near";
  return "setup-badge is-watch";
}

export function triggerBadge(tier: TriggerTier | null, bucket: ActionBucket | null = null): string {
  if (tier === "prime") return "Prime";
  if (tier === "standard") return "Std 0.5x";
  if (bucket === "gtt") return "GTT";
  if (bucket === "near") return "Near";
  return "Watch";
}

/** Live desk only. The backtest desk row uses this same gate. Prime is not quality-capped. */
function capDisplayedQuality(raw: number | null, rs: number | null, uptrend: boolean): number | null {
  if (raw == null) return null;
  if (rs != null && rs >= RS_EDGE && uptrend) return Math.min(100, raw);
  if (rs != null && rs < 0) return Math.min(raw, 40);
  return Math.min(raw, 55);
}

/**
 * Executable live trigger. Prime needs sector ≥ 55. Standard needs displayed quality ≥ 50.
 * ATR above 6% of price, turnover under ₹20 crore, unknown/red, and Amber Standard all fail closed.
 */
export function passesLiveDeskEntry(input: {
  bars: readonly PriceBar[];
  ema20: readonly (number | null)[];
  ema50: readonly (number | null)[];
  index: number;
  relativeStrength: number | null;
  rvol: number | null;
  atr14: number | null;
  sectorScore: number | null;
  regimeTier: MarketRegimeTier;
  rsi?: number | null;
}): { tier: TriggerTier; quality: number } | null {
  const volumeOk = input.rvol == null || input.rvol >= RVOL_FLOOR;
  let tier = classifyTriggerTier(
    input.bars,
    input.ema20,
    input.ema50,
    input.index,
    input.relativeStrength,
    volumeOk,
    input.rvol,
    input.atr14,
    input.rsi,
  );
  tier = applyPrimeSectorGate(
    tier,
    input.sectorScore,
    standardContinuationPasses(
      input.bars,
      input.ema20,
      input.ema50,
      input.index,
      input.relativeStrength,
      volumeOk,
      input.rvol,
      input.atr14,
      input.rsi,
    ),
  );
  if (!allowNewEntry(input.regimeTier, tier) || tier == null) return null;
  const turnover = averageDailyTurnover(input.bars, input.index);
  if (turnover == null || turnover < MIN_AVG_TURNOVER) return null;
  const fast = input.ema20[input.index];
  const slow = input.ema50[input.index];
  const bar = input.bars[input.index];
  if (fast == null || bar == null) return null;
  const uptrend = slow != null && fast > slow && bar.close > slow;
  const raw =
    input.relativeStrength != null
      ? scoreSetupQuality({
          edge: input.relativeStrength,
          rvol: input.rvol,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          ema20: fast,
          ema50: slow,
          atr14: input.atr14,
          closeStrength: closeLocationValue(bar),
          sectorScore: input.sectorScore,
        })
      : null;
  const quality = capDisplayedQuality(raw, input.relativeStrength, uptrend);
  if (tier === "standard" && (quality == null || quality < STANDARD_QUALITY_MIN)) return null;
  return { tier, quality: quality ?? 0 };
}

function watchBucket(
  bar: PriceBar,
  bars: PriceBar[],
  index: number,
  ema20: number | null,
  ema50: number | null,
  spread: number | null,
  rs: number | null,
  rvol: number | null,
  band = PULLBACK_BAND,
): ActionBucket {
  const youngTrend = ema20 != null && spread != null && spread > 0 && spread <= CONTINUATION_SPREAD_MAX;
  const trendValid = ema20 != null && ema50 != null && bar.close > ema50 && ema20 > ema50 && spread != null && spread <= CONTINUATION_SPREAD_MAX;
  const aboveZone = ema20 != null && bar.low > ema20 * (1 + band);
  const insideZone = ema20 != null && ema20 > 0 && bar.low <= ema20 * (1 + band) && bar.close >= ema20 * 0.995;
  const leading = rs != null && rs >= RS_EDGE;
  const volumeOk = rvol != null && rvol >= RVOL_FLOOR;
  if (youngTrend && leading && volumeOk && (aboveZone || isTwentyDayHigh(bars, index))) return "gtt";
  const rsShy = rs != null && rs >= 0.015 && rs < RS_EDGE && volumeOk;
  const volumeDry = leading && rvol != null && rvol >= 0.3 && rvol < RVOL_FLOOR;
  if (trendValid && insideZone && (rsShy || volumeDry)) return "near";
  return "lagging";
}

function isTwentyDayHigh(bars: PriceBar[], index: number): boolean {
  if (index < 19) return false;
  let prior = bars[index - 19].high;
  for (let k = index - 18; k < index; k += 1) prior = Math.max(prior, bars[k].high);
  return bars[index].high >= prior;
}

export function executionClipboardText(input: { symbol: string; setup: SwingSetup }): string | null {
  const { setup, symbol } = input;
  if (setup.entryPrice == null) return null;
  const maxBuy = setup.triggerTier ? setup.maxChasePrice : setup.buyZoneTop;
  const qty = setup.suggestedQty;
  const t1Qty = qty != null && qty > 0 ? Math.max(1, Math.ceil(qty / 2)) : null;
  const t2Qty = qty != null && t1Qty != null ? Math.max(0, qty - t1Qty) : null;
  const qtyText =
    qty == null ? "—" : t1Qty != null && t2Qty != null && qty > 1 ? `${qty} (T1: ${t1Qty} / T2: ${t2Qty})` : `${qty}`;
  return [
    `Symbol: ${symbol}`,
    `Entry: ${formatInr(setup.entryPrice)}`,
    `MaxBuy: ${maxBuy == null ? "—" : formatInr(maxBuy)}`,
    `SL: ${setup.initialStopLoss == null ? "—" : formatInr(setup.initialStopLoss)}`,
    `T1 (50% @ +6%): ${setup.t1TargetPrice == null ? "—" : formatInr(setup.t1TargetPrice)}`,
    `T2 (50%): Trail EMA 20 (stop → +1.5% after T1)`,
    `Qty: ${qtyText}`,
  ].join("\n");
}

export function executionAlertText(input: {
  tier: TriggerTier;
  symbol: string;
  sector: string;
  setup: SwingSetup;
}): string {
  const label = input.tier === "prime" ? "[PRIME TRIGGER - v1.4]" : "[STD WATCH - 0.5x]";
  const spread = input.setup.emaSpreadPct == null ? "—" : `${input.setup.emaSpreadPct.toFixed(1)}%`;
  const rvol = input.setup.rvol == null ? "—" : input.setup.rvol.toFixed(2);
  const entry = input.setup.entryPrice;
  const stop = input.setup.initialStopLoss;
  const t1 = input.setup.t1TargetPrice;
  const qty = input.setup.suggestedQty;
  const t1Qty = qty != null && qty > 0 ? Math.max(1, Math.ceil(qty / 2)) : null;
  const t2Qty = qty != null && t1Qty != null ? Math.max(0, qty - t1Qty) : null;
  const qtyText =
    qty == null ? "—" : t1Qty != null && t2Qty != null && qty > 1 ? `${qty} sh (T1 ${t1Qty} / T2 ${t2Qty})` : `${qty} sh`;
  return [
    label,
    `${input.symbol} (${input.sector})`,
    `Quality ${input.setup.quality ?? "—"} · EMA Spread ${spread} · RVOL ${rvol}`,
    `Entry ${entry == null ? "—" : formatInr(entry)}`,
    `Max Buy (Gap Guard) ${input.setup.maxChasePrice == null ? "—" : formatInr(input.setup.maxChasePrice)}`,
    `Stop Loss (Hard Anchor / EMA20 Close) ${stop == null ? "—" : formatInr(stop)}`,
    `T1 (Book 50% @ +6%) ${t1 == null ? "—" : formatInr(t1)} · T2 Trail EMA 20`,
    `Suggested Qty ${qtyText}`,
  ].join("\n");
}

export function chaseLimits(entry: number, stop: number | null, atr14: number | null): {
  maxChasePrice: number;
  riskRewardTo12Pct: number | null;
  targetPrice: number;
} {
  const validStop = stop != null && Number.isFinite(stop) && stop < entry ? stop : null;
  const risk = validStop != null ? entry - validStop : null;
  const byAtr = atr14 != null && atr14 > 0 ? entry + 0.35 * atr14 : Number.POSITIVE_INFINITY;
  const byPercent = entry * 1.012;
  const byRisk = risk != null ? entry + 0.2 * risk : Number.POSITIVE_INFINITY;
  const maxChasePrice = Number(Math.min(byAtr, byPercent, byRisk).toFixed(2));
  const targetPrice = Number(profitTargetPrice(entry, validStop).toFixed(2));
  const reward = targetPrice - entry;
  return {
    maxChasePrice,
    riskRewardTo12Pct: risk != null && risk > 0 ? Number((reward / risk).toFixed(2)) : null,
    targetPrice,
  };
}

function watchHint(input: {
  bar: PriceBar;
  bars: PriceBar[];
  index: number;
  closes: number[];
  ema20: number | null;
  ema50: number | null;
  spread: number | null;
  relativeStrength: number | null;
  rvol: number | null;
  extended: boolean;
  traits: number;
  tier: TriggerTier | null;
  liquid: boolean;
  buyZoneTop: number | null;
  bucket: ActionBucket | null;
  regime?: MarketRegimeStatus | null;
}): string {
  if ((input.regime?.tier === "unknown" || input.regime?.tier === "red") && input.tier != null) {
    return input.regime.tier === "unknown"
      ? "Regime unknown (Nifty history short) · No new entries"
      : "Market in RED regime · No new entries";
  }
  if (input.tier === "standard" && !ALLOW_STANDARD_DESK_ENTRIES) {
    return "Standard continuation paused (v1.4 Prime-only desk) · stays a watch";
  }
  if (input.regime?.tier === "amber" && input.tier === "standard") {
    return "Market in AMBER regime · Standard continuation paused (Prime only)";
  }
  const fast = input.ema20;
  if (input.bucket === "gtt" && fast != null && input.buyZoneTop != null) {
    return `Wait for dip <= ${formatInr(input.buyZoneTop)} (EMA20 ${formatInr(fast)})`;
  }
  const slow = input.ema50;
  const uptrend = fast != null && slow != null && fast > slow;
  const youngEnough = input.spread != null && input.spread > 0 && input.spread <= CONTINUATION_SPREAD_MAX;
  const rsOk = input.relativeStrength != null && input.relativeStrength >= RS_EDGE;
  const inZone = fast != null && input.bar.low <= fast * (1 + PULLBACK_BAND);
  if (!uptrend) return "Needs EMA20 > EMA50 (Downtrend)";
  if (input.spread != null && input.spread > CONTINUATION_SPREAD_MAX) {
    return `Spread ${(input.spread * 100).toFixed(1)}% > ${(CONTINUATION_SPREAD_MAX * 100).toFixed(1)}% (Late Trend)`;
  }
  if (!rsOk) {
    const current = input.relativeStrength == null ? "n/a" : `${(input.relativeStrength * 100).toFixed(1)}%`;
    return `Needs RS >= +3.0% (currently ${current})`;
  }
  if (input.rvol != null && input.rvol < RVOL_FLOOR) return `RVOL ${input.rvol.toFixed(2)}x < 0.45 floor`;
  if (input.extended || isFreshHigh(input.bars, input.index)) {
    const rsi = wilderRsi(input.closes, 14)[input.index];
    const fresh = isFreshHigh(input.bars, input.index);
    if (fresh && rsi != null && rsi > RSI_EXTENDED) return "Extended: Fresh 20d High / RSI > 75";
    if (fresh) return "Extended: Fresh 20d High";
    if (rsi != null && rsi > RSI_EXTENDED) return "Extended: RSI > 75";
    return "Extended: 5-day return > 10%";
  }
  if (youngEnough && rsOk && !inZone && fast != null && input.buyZoneTop != null) {
    return `Wait for dip <= ${formatInr(input.buyZoneTop)} (EMA20 ${formatInr(fast)})`;
  }
  if (fast != null && input.bar.close < fast) return `Close is under EMA 20 (${formatInr(fast)})`;
  if (input.tier != null && !input.liquid) return "Average turnover is under ₹20 crore";
  if (input.spread != null && input.spread > YOUNG_SPREAD_MAX && input.traits < STANDARD_TRAIT_MIN) {
    return "Needs 2 of: RVOL ≤ 0.85, red day, green bounce (CLV ≥ 0.6), or close ≤ 2.5% from EMA 20";
  }
  return "Pullback is close, but today's session is not a trigger";
}

function isFreshHigh(bars: PriceBar[], index: number): boolean {
  if (index < 20) return false;
  let priorHigh = bars[index - 20].close;
  for (let k = index - 19; k < index; k += 1) priorHigh = Math.max(priorHigh, bars[k].close);
  return bars[index].close > priorHigh;
}

export function rsVersusNifty(bars: readonly PriceBar[], nifty: readonly PriceBar[]): number | null {
  const series = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  if (series.length <= 20) return null;
  return niftyEdge(series, series.length - 1, nifty);
}

export function prioritize<T extends ScoredSecurity>(items: readonly T[], setups: Record<string, SwingSetup>): T[] {
  return [...items].sort((a, b) => {
    const rank = (setups[b.symbol]?.priority ?? 0) - (setups[a.symbol]?.priority ?? 0);
    if (rank !== 0) return rank;
    const quality = (setups[b.symbol]?.quality ?? 0) - (setups[a.symbol]?.quality ?? 0);
    if (quality !== 0) return quality;
    return b.conviction - a.conviction || a.symbol.localeCompare(b.symbol);
  });
}

function actionFor(input: {
  pullback: boolean;
  tier: TriggerTier | null;
  liquid: boolean;
  outperforms: boolean;
  extended: boolean;
  volume: VolumeRead;
  rising: boolean;
  capitulation: boolean;
  niftyAbove: boolean | null;
  regime?: MarketRegimeStatus | null;
  closeStrength: number;
  traits: number;
  spreadPct: number | null;
}): string | null {
  if (!(input.pullback && input.outperforms && !input.extended) || input.volume === "weak") return null;
  const marketNote =
    input.regime?.tier === "green"
      ? " Nifty is in GREEN regime (bullish alignment above EMA 20 & 50)."
      : input.regime?.tier === "amber"
        ? " Nifty is in AMBER regime (half risk 0.5x, testing EMA 20–50)."
        : input.regime?.tier === "red"
          ? " Nifty is in RED regime (below EMA 50)."
          : input.regime?.tier === "unknown"
            ? " Regime unknown — no new entries until Nifty history loads."
            : input.niftyAbove == null
              ? ""
              : input.niftyAbove
                ? " Nifty is above its EMA 20."
                : " Nifty is below its EMA 20.";
  if (input.tier != null && !input.liquid) {
    return "The pullback qualifies, but average daily turnover is under ₹20 crore, so it stays a watch.";
  }
  if (input.tier === "prime") {
    const riskDesc =
      input.regime?.tier === "amber"
        ? "Amber regime applies 0.5x defensive risk"
        : input.regime?.tier === "unknown" || input.regime?.tier === "red"
          ? "regime blocks new risk"
          : "takes full configured risk";
    return `Prime trigger. EMA 20 is still within 2.5% of EMA 50, so this ${riskDesc}.${marketNote}`;
  }
  if (input.tier === "standard") {
    return `Continuation trigger. The EMA spread is 2.5%–5.0% with ${input.traits} winning traits, so size is half the configured risk.${marketNote}`;
  }
  const spread =
    input.spreadPct == null ? "the EMA spread is unavailable" : `the EMA 20–50 spread is ${input.spreadPct.toFixed(1)}%`;
  const why = !input.rising
    ? "EMA 20 is falling"
    : input.capitulation
      ? "the session is a wide-range bearish breakdown"
      : input.traits < STANDARD_TRAIT_MIN
        ? `${spread}, and fewer than two continuation traits are present`
        : spread;
  return `Watch. Pullback shape is there, but it is not a trigger because ${why}.`;
}

export function scoreSetupQuality(input: {
  edge: number;
  rvol: number | null;
  open: number;
  high: number;
  low: number;
  close: number;
  ema20: number;
  ema50: number | null;
  atr14: number | null;
  closeStrength: number;
  sectorScore?: number | null;
}): number {
  return qualityScore(input);
}

/** 20-session average daily rupee turnover (volume × typical price). ₹20 crore is the live trigger floor. */
export const MIN_AVG_TURNOVER = 20_00_00_000;

export function averageDailyTurnover(bars: readonly PriceBar[], index = bars.length - 1): number | null {
  if (index < 19) return null;
  let sum = 0;
  for (let k = index - 19; k <= index; k += 1) {
    const bar = bars[k];
    const volume = bar?.volume;
    if (volume == null || volume <= 0 || !(bar.close > 0)) return null;
    const typical = (bar.high + bar.low + bar.close) / 3;
    sum += volume * (typical > 0 ? typical : bar.close);
  }
  return sum / 20;
}

export function deskPicks<T extends ScoredSecurity>(
  items: readonly T[],
  setups: Record<string, SwingSetup>,
  limit = 5,
  perSector = 2,
): Set<string> {
  const picks = new Set<string>();
  const used = new Map<string, number>();
  for (const item of prioritize(items, setups)) {
    if (!setups[item.symbol]?.pullbackSwing) continue;
    const count = used.get(item.sector) ?? 0;
    if (count >= perSector) continue;
    picks.add(item.symbol);
    used.set(item.sector, count + 1);
    if (picks.size >= limit) break;
  }
  return picks;
}

function qualityScore(input: {
  edge: number;
  rvol: number | null;
  open: number;
  high: number;
  low: number;
  close: number;
  ema20: number;
  ema50: number | null;
  atr14: number | null;
  closeStrength: number;
  sectorScore?: number | null;
}): number {
  const spread = input.ema50 != null && input.ema50 > 0 ? (input.ema20 - input.ema50) / input.ema50 : null;
  const spreadPts = spread == null ? 10 : spread < 0.008 ? 45 : spread < 0.015 ? 38 : spread <= 0.025 ? 28 : 12;
  const rvol = input.rvol;
  const redPullback = input.close <= input.open;
  const volumePts =
    rvol == null ? 10 : redPullback && rvol <= 0.9 ? 28 : rvol <= 0.85 ? 22 : rvol <= 1.1 ? 14 : 6;
  const rsPts = input.edge >= 0.05 ? 18 : input.edge >= 0.03 ? 12 : 6;
  const sectorPts = input.sectorScore != null && input.sectorScore >= 70 ? 9 : input.sectorScore != null && input.sectorScore >= 55 ? 5 : 2;
  return Math.round(Math.min(100, Math.max(0, spreadPts + volumePts + rsPts + sectorPts)));
}

/** Find Nifty's close on `date`, or the nearest prior Nifty session within 3 calendar days. */
function niftyCloseOnOrBefore(sortedNifty: readonly PriceBar[], date: string): number | null {
  const targetMs = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(targetMs)) return null;
  let lo = 0;
  let hi = sortedNifty.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sortedNifty[mid].date <= date) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best < 0) return null;
  const hit = sortedNifty[best];
  const hitMs = Date.parse(`${hit.date}T00:00:00Z`);
  if (!Number.isFinite(hitMs) || targetMs - hitMs > 3 * 86_400_000) return null;
  return hit.close > 0 ? hit.close : null;
}

/**
 * Date-aligned compounded ratio relative strength over 20 sessions:
 *   RS = (1 + r_stock) / (1 + r_nifty) − 1
 * Aligns both endpoints to exact matching Nifty dates so 1-day cache skew never corrupts RS.
 */
function niftyEdge(series: readonly PriceBar[], index: number, nifty: readonly PriceBar[]): number | null {
  if (index < 20 || nifty.length < 21) return null;
  const endBar = series[index];
  const baseBar = series[index - 20];
  if (!endBar || !baseBar || !(baseBar.close > 0) || !(endBar.close > 0)) return null;
  const sortedNifty = [...nifty].sort((a, b) => a.date.localeCompare(b.date));
  const niftyLatestDate = sortedNifty[sortedNifty.length - 1]?.date;
  if (niftyLatestDate && endBar.date < niftyLatestDate) {
    const gapMs = Date.parse(`${niftyLatestDate}T00:00:00Z`) - Date.parse(`${endBar.date}T00:00:00Z`);
    if (Number.isFinite(gapMs) && gapMs > 5 * 86_400_000) return null;
  }
  const niftyEnd = niftyCloseOnOrBefore(sortedNifty, endBar.date);
  const niftyBase = niftyCloseOnOrBefore(sortedNifty, baseBar.date);
  if (niftyEnd == null || niftyBase == null || !(niftyBase > 0)) return null;
  const stockFactor = endBar.close / baseBar.close;
  const marketFactor = niftyEnd / niftyBase;
  return stockFactor / marketFactor - 1;
}

function volumeRead(bars: PriceBar[], index: number): VolumeRead {
  const relative = relativeVolumeAt(bars, index);
  if (relative == null) return "unknown";
  if (relative < RVOL_FLOOR) return "weak";
  if (relative < RVOL_FINE) return "moderate";
  return "fine";
}

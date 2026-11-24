import { ema, type PriceBar } from "../analysis";
import { riskScaleForRegime } from "../strategy/policy";

export type SessionPhase = "open" | "premarket" | "afterhours" | "closed";
export type MarketRegimeTier = "green" | "amber" | "red" | "unknown";

/** Sessions used to decide whether EMA 20 is falling. */
export const EMA_SLOPE_SESSIONS = 5;
/** Green extension warning. Entries stay open. Strictly above this fraction of EMA 20. */
export const GREEN_EXTENSION_LIMIT = 0.08;
export const EXTENSION_WARNING = "Extended – price > 8% above EMA 20";

export interface MarketRegimeStatus {
  tier: MarketRegimeTier;
  label: string;
  tone: "strong" | "watch" | "weak";
  summary: string;
  /**
   * Prime risk shown on the regime badge.
   * Standard uses standardRiskScale and can be lower. A falling EMA 20 cuts Prime to 0.5×
   * while the tier stays Green.
   */
  riskMultiplier: number;
  /** Effective size for a Prime trigger. 0 when the tier blocks entries. */
  primeRiskScale: number;
  /** Effective size for a Standard trigger. 0 when Standard is blocked. */
  standardRiskScale: number;
  maxSlots: number;
  niftyClose: number | null;
  ema20: number | null;
  ema50: number | null;
  /** Green only. EMA 20 is below its value EMA_SLOPE_SESSIONS ago, so Prime is not 1×. */
  ema20Falling: boolean;
  /** Set only in Green when price is more than 8% above EMA 20. Does not block entries. */
  extensionWarning: string | null;
}

export interface MarketStatus {
  phase: SessionPhase;
  label: string;
  clock: string;
  dateLabel: string;
}

/** NSE cash session. The status clock uses this window; it is not a price feed. */
export const SESSION_WINDOW = "9:15 AM – 3:30 PM IST";

const IST = "Asia/Kolkata";
const OPEN_MINUTES = 9 * 60 + 15;
const CLOSE_MINUTES = 15 * 60 + 30;

const SESSION_LABEL: Record<SessionPhase, string> = {
  open: "Market open",
  premarket: "Pre-open",
  afterhours: "After hours",
  closed: "Market closed",
};

function istParts(now: Date): { weekday: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: IST,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    weekday: read("weekday"),
    hour: Number(read("hour")),
    minute: Number(read("minute")),
  };
}

/** NSE cash-session status from the India clock. Open on weekdays from 9:15 AM to 3:30 PM IST. */
export function marketStatus(now: Date = new Date()): MarketStatus {
  const { weekday, hour, minute } = istParts(now);
  const minutes = hour * 60 + minute;
  const weekend = weekday === "Sat" || weekday === "Sun";
  const phase: SessionPhase =
    !weekend && minutes >= OPEN_MINUTES && minutes < CLOSE_MINUTES ? "open" : "closed";

  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: IST,
    hour: "numeric",
    minute: "2-digit",
  }).format(now);

  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: IST,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(now);

  return {
    phase,
    label: SESSION_LABEL[phase],
    clock: `${time} IST`,
    dateLabel,
  };
}

export interface RegimeReading {
  tier: MarketRegimeTier;
  ema20Falling: boolean;
  extensionWarning: string | null;
}

/**
 * Shared Green / Amber / Red test.
 * Green: close >= EMA 20 >= EMA 50. A falling EMA 20 stays Green; sizing is handled separately.
 * Amber: EMA 20 >= EMA 50 and EMA 50 <= close < EMA 20.
 * Red: close < EMA 50, or EMA 20 < EMA 50 (including a close back above both averages).
 * Extension warning is Green only and does not change the tier.
 */
export function classifyNiftyRegime(input: {
  close: number;
  ema20: number;
  ema50: number;
  ema20FiveSessionsAgo: number | null;
}): RegimeReading {
  const { close, ema20, ema50, ema20FiveSessionsAgo } = input;
  if (close >= ema20 && ema20 >= ema50) {
    const ema20Falling = ema20FiveSessionsAgo == null || ema20 < ema20FiveSessionsAgo;
    const extended = ema20 > 0 && (close - ema20) / ema20 > GREEN_EXTENSION_LIMIT;
    return {
      tier: "green",
      ema20Falling,
      extensionWarning: extended ? EXTENSION_WARNING : null,
    };
  }
  // Weaker shape (EMA 20 still under EMA 50, even if price is above both) is Red.
  if (close < ema50 || ema20 < ema50) {
    return { tier: "red", ema20Falling: false, extensionWarning: null };
  }
  return { tier: "amber", ema20Falling: false, extensionWarning: null };
}

function unknownRegime(summary: string, niftyClose: number | null): MarketRegimeStatus {
  return {
    tier: "unknown",
    label: "Regime: Unknown",
    tone: "watch",
    summary,
    riskMultiplier: 0,
    primeRiskScale: 0,
    standardRiskScale: 0,
    maxSlots: 0,
    niftyClose,
    ema20: null,
    ema50: null,
    ema20Falling: false,
    extensionWarning: null,
  };
}

/**
 * 3-Tier Traffic Light Market Regime Engine:
 * - GREEN: Close >= EMA 20 >= EMA 50. Prime is 1× only while EMA 20 is flat or rising. 5 slots.
 * - AMBER: Close is between EMA 50 and EMA 20 while EMA 20 >= EMA 50. Prime 0.5×, 3 slots.
 * - RED: Close < EMA 50, or EMA 20 < EMA 50. No new entries.
 * - UNKNOWN: Fewer than 50 bars or a missing EMA. No new entries.
 */
export function evaluateMarketRegime(niftyBars: readonly PriceBar[] = []): MarketRegimeStatus {
  const series = [...niftyBars].sort((a, b) => a.date.localeCompare(b.date));
  if (series.length < 50) {
    return unknownRegime("Nifty candles unavailable. No new entries until regime is known (fail closed).", null);
  }

  const closes = series.map((bar) => bar.close);
  const ema20Series = ema(closes, 20);
  const ema50Series = ema(closes, 50);
  const i = series.length - 1;
  const close = closes[i];
  const fast = ema20Series[i];
  const slow = ema50Series[i];

  if (fast == null || slow == null) {
    return unknownRegime(
      "Insufficient Nifty moving averages. No new entries until regime is known (fail closed).",
      close,
    );
  }

  const priorFast = i >= EMA_SLOPE_SESSIONS ? ema20Series[i - EMA_SLOPE_SESSIONS] : null;
  const reading = classifyNiftyRegime({
    close,
    ema20: fast,
    ema50: slow,
    ema20FiveSessionsAgo: priorFast,
  });
  const primeRiskScale = riskScaleForRegime(reading.tier, "prime", { ema20Falling: reading.ema20Falling });
  const standardRiskScale = riskScaleForRegime(reading.tier, "standard", { ema20Falling: reading.ema20Falling });
  const shared = {
    primeRiskScale,
    standardRiskScale,
    riskMultiplier: primeRiskScale,
    niftyClose: close,
    ema20: fast,
    ema50: slow,
    ema20Falling: reading.ema20Falling,
    extensionWarning: reading.extensionWarning,
  };

  if (reading.tier === "green") {
    const slope = reading.ema20Falling
      ? "EMA 20 is falling, so Prime and Standard both size at 0.5×."
      : "Prime 1.0×, Standard 0.5×.";
    const extension = reading.extensionWarning ? ` ${reading.extensionWarning}.` : "";
    return {
      ...shared,
      tier: "green",
      label: "GREEN REGIME",
      tone: "strong",
      summary: `Bullish structure: close is at or above EMA 20 and EMA 50. ${slope} 5 slots.${extension}`,
      maxSlots: 5,
    };
  }

  if (reading.tier === "red") {
    return {
      ...shared,
      tier: "red",
      label: "RED REGIME",
      tone: "weak",
      summary: "No new entries. Nifty is below EMA 50, or EMA 20 has not crossed back above EMA 50.",
      maxSlots: 0,
    };
  }

  return {
    ...shared,
    tier: "amber",
    label: "AMBER REGIME",
    tone: "watch",
    summary: "Cautious: Nifty is between EMA 50 and EMA 20. Half risk (0.5×), max 3 slots, Prime only.",
    maxSlots: 3,
  };
}

import type { Tone } from "../scanner";
import type { SwingSetup } from "./setup";

export type DecisionVerdict = "Strong Consider" | "Consider" | "Wait";
export type RiskLevel = "Low" | "Medium" | "High";

export interface DecisionSupport {
  verdict: DecisionVerdict;
  verdictTone: Tone;
  chartQuality: { label: string; tone: Tone; detail: string };
  marketCondition: { label: string; tone: Tone; detail: string };
  riskLevel: { label: RiskLevel; tone: Tone; detail: string };
  qualityFactor: { label: string; tone: Tone; detail: string };
  readiness: "Ready" | "Mixed" | "Not ready";
  readinessTone: Tone;
  summary: string;
}

/** Decision layer for v1.2. Guidance only — no orders. */
export function buildDecisionSupport(setup: SwingSetup, closeStrength: number, lowDistance: number): DecisionSupport {
  const chartQuality = chartQualityLine(setup, closeStrength, lowDistance);
  const marketCondition = marketLine(setup);
  const riskLevel = riskLine(setup, closeStrength);
  const qualityFactor = qualityLine(setup);
  const verdict = overallVerdict(setup, chartQuality.tone, marketCondition.tone, riskLevel.tone, qualityFactor.tone);
  const readiness = readinessFrom(verdict, chartQuality.tone, marketCondition.tone, riskLevel.tone);
  return {
    verdict: verdict.label,
    verdictTone: verdict.tone,
    chartQuality,
    marketCondition,
    riskLevel,
    qualityFactor,
    readiness: readiness.label,
    readinessTone: readiness.tone,
    summary: verdict.summary,
  };
}

function chartQualityLine(setup: SwingSetup, closeStrength: number, lowDistance: number): DecisionSupport["chartQuality"] {
  if (!setup.pullback) {
    return { label: "No clean pullback", tone: "weak", detail: "Price is not in the v1.2 pullback zone near EMA 20." };
  }
  if (!setup.pullbackSwing) {
    const why = setup.extended
      ? "The move looks extended."
      : !setup.outperforms
        ? "RS versus Nifty is below the 3% edge."
        : setup.volume === "weak"
          ? "Volume is extremely weak."
          : "Pullback shape is not a prime or continuation trigger today.";
    return { label: "Pullback incomplete", tone: "watch", detail: why };
  }
  if (setup.triggerTier === "standard") {
    return {
      label: "Continuation",
      tone: "watch",
      detail: "EMA spread is between 2.5% and 5.0% with two winning traits. Size at half the configured risk.",
    };
  }
  const near = lowDistance <= 0.02;
  const firmClose = closeStrength >= 0.35;
  if (near && firmClose) {
    return { label: "Clean pullback", tone: "strong", detail: "Uptrend pullback with a firm close off the day’s low." };
  }
  if (closeStrength < 0.25) {
    return { label: "Weak close", tone: "watch", detail: "Pullback tag is there, but the session closed near its low." };
  }
  if (!near) {
    return { label: "Wide tag", tone: "watch", detail: "Pullback is valid but the low did not come very close to EMA 20." };
  }
  return { label: "Acceptable pullback", tone: "strong", detail: "Meets the pullback + RS rule with an acceptable session shape." };
}

function marketLine(setup: SwingSetup): DecisionSupport["marketCondition"] {
  const regime = setup.marketRegime;
  if (!regime || regime.tier === "unknown") {
    if (setup.niftyAbove == null) {
      return { label: "Market unknown", tone: "watch", detail: "Connect Kite for Nifty candles before reading the backdrop." };
    }
    return setup.niftyAbove
      ? { label: "Supportive", tone: "strong", detail: "Nifty is above its EMA 20." }
      : { label: "Not supportive", tone: "watch", detail: "Nifty is below its EMA 20. The setup can still qualify but ranks lower." };
  }
  if (regime.tier === "green") {
    return { label: "Green Regime", tone: "strong", detail: regime.summary };
  }
  if (regime.tier === "amber") {
    return { label: "Amber Regime", tone: "watch", detail: regime.summary };
  }
  return { label: "Red Regime", tone: "weak", detail: regime.summary };
}

function riskLine(setup: SwingSetup, closeStrength: number): DecisionSupport["riskLevel"] {
  if (setup.extended) {
    return {
      label: "High",
      tone: "weak",
      detail: "RSI or the 5-day move is stretched. Prefer to wait for a cooler entry.",
    };
  }
  if (setup.volume === "weak" || closeStrength < 0.2) {
    return { label: "High", tone: "weak", detail: "Weak volume or a soft close raises entry risk." };
  }
  if (setup.volume === "moderate" || closeStrength < 0.35) {
    return { label: "Medium", tone: "watch", detail: "Acceptable for v1.2, but size conservatively." };
  }
  return { label: "Low", tone: "strong", detail: "Not extended, with reasonable volume and close." };
}

function qualityLine(setup: SwingSetup): DecisionSupport["qualityFactor"] {
  if (setup.quality == null) {
    return { label: "No quality score", tone: "watch", detail: "Not a Pullback Swing on today’s candles." };
  }
  if (setup.quality >= 70) {
    return { label: `Quality ${setup.quality}`, tone: "strong", detail: "High composite score from RS, proximity, volume, and sector." };
  }
  if (setup.quality >= 55) {
    return { label: `Quality ${setup.quality}`, tone: "watch", detail: "Solid but not top-tier versus other pullback names." };
  }
  return { label: `Quality ${setup.quality}`, tone: "weak", detail: "Fair score. Compare with stronger setups before sizing." };
}

function overallVerdict(
  setup: SwingSetup,
  chartTone: Tone,
  marketTone: Tone,
  riskTone: Tone,
  qualityTone: Tone,
): { label: DecisionVerdict; tone: Tone; summary: string } {
  if (setup.triggerTier === "standard") {
    return {
      label: "Consider",
      tone: "watch",
      summary: "Continuation trigger. The trend is no longer young, so the card sizes at half the configured risk.",
    };
  }
  if (!setup.pullbackSwing || setup.extended) {
    return {
      label: "Wait",
      tone: "weak",
      summary: setup.extended
        ? "Wait for the extension to cool before considering a swing entry."
        : "Wait until the stock shows a full v1.2 Pullback Swing on live candles.",
    };
  }
  const strong =
    qualityTone === "strong" && chartTone === "strong" && marketTone === "strong" && riskTone !== "weak";
  if (strong) {
    return {
      label: "Strong Consider",
      tone: "strong",
      summary: "High quality, clean pullback, supportive Nifty, and controlled risk. You still choose size and timing.",
    };
  }
  const weakFactors = [chartTone, marketTone, riskTone, qualityTone].filter((tone) => tone === "weak").length;
  const watchFactors = [chartTone, marketTone, riskTone, qualityTone].filter((tone) => tone === "watch").length;
  if (weakFactors > 0 || watchFactors >= 3) {
    return {
      label: "Wait",
      tone: "weak",
      summary: "Too many caution flags today. Watch the next session or a stronger name.",
    };
  }
  if (watchFactors >= 1 || qualityTone === "watch") {
    return {
      label: "Consider",
      tone: "watch",
      summary: "The setup qualifies, but one factor is only neutral. Review the chart before acting.",
    };
  }
  return {
    label: "Consider",
    tone: "watch",
    summary: "Decent pullback swing. Confirm the chart and your risk before entry.",
  };
}

function readinessFrom(
  verdict: { label: DecisionVerdict; tone: Tone },
  chartTone: Tone,
  marketTone: Tone,
  riskTone: Tone,
): { label: DecisionSupport["readiness"]; tone: Tone } {
  if (verdict.label === "Strong Consider") return { label: "Ready", tone: "strong" };
  if (verdict.label === "Wait") return { label: "Not ready", tone: "weak" };
  const greens = [chartTone, marketTone, riskTone].filter((tone) => tone === "strong").length;
  if (greens >= 2) return { label: "Mixed", tone: "watch" };
  return { label: "Mixed", tone: "watch" };
}

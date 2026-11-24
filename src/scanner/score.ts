import type {
  FactorInput,
  FactorKey,
  FactorReading,
  Grade,
  Recommendation,
  ScoredSecurity,
  Security,
  Stance,
  Tone,
} from "./types";

/** How the four factor readings combine into one conviction score. */
export const FACTOR_WEIGHTS = {
  trueRs: 0.35,
  volume: 0.2,
  sector: 0.25,
  closingStrength: 0.2,
} as const;

export const FACTOR_LABELS: Record<FactorKey, string> = {
  trueRs: "True RS",
  volume: "Volume",
  sector: "Sector",
  closingStrength: "Closing Strength",
};

export const GRADE_A_PLUS_FLOOR = 85;
export const GRADE_A_FLOOR = 75;
/** B / Watch begins here. Below this, a name is not a recommendation. */
export const RECOMMENDATION_FLOOR = 62;
export const WEAK_FLOOR = 50;

const FACTOR_ORDER: readonly FactorKey[] = [
  "trueRs",
  "volume",
  "sector",
  "closingStrength",
];

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** Integer 0–100 factor readings. The same values are what the card displays. */
export function normalizeFactors(factors: FactorInput): Record<FactorKey, number> {
  return {
    trueRs: Math.round(clampScore(factors.trueRs)),
    volume: Math.round(clampScore(factors.volume)),
    sector: Math.round(clampScore(factors.sector)),
    closingStrength: Math.round(clampScore(factors.closingStrength)),
  };
}

/**
 * Conviction is the weighted blend of True RS, Volume, Sector, and Closing Strength.
 * Returns an integer from 0 to 100.
 */
export function scoreFactors(factors: FactorInput): number {
  const normalized = normalizeFactors(factors);
  const raw =
    normalized.trueRs * FACTOR_WEIGHTS.trueRs +
    normalized.volume * FACTOR_WEIGHTS.volume +
    normalized.sector * FACTOR_WEIGHTS.sector +
    normalized.closingStrength * FACTOR_WEIGHTS.closingStrength;
  return Math.round(clampScore(raw));
}

/**
 * Letter grade is a conviction rank, not an entry.
 * A+ and A are the strong band. B is the watch band. Below the floor there is no letter.
 * A long is an order only when a Prime or Standard trigger is also active.
 */
export function gradeForScore(score: number): Grade | null {
  if (score >= GRADE_A_PLUS_FLOOR) return "A+";
  if (score >= GRADE_A_FLOOR) return "A";
  if (score >= RECOMMENDATION_FLOOR) return "B";
  return null;
}

/** True for the A+ and A rank. This does not mean the name is an executable trigger. */
export function isStrongGrade(grade: Grade | null | undefined): boolean {
  return grade === "A+" || grade === "A";
}

/** High conviction → Strong, mid → Watch, low → Weak or Avoid. */
export function stanceForScore(score: number): Stance {
  if (score >= GRADE_A_FLOOR) return "Strong";
  if (score >= RECOMMENDATION_FLOOR) return "Watch";
  if (score >= WEAK_FLOOR) return "Weak";
  return "Avoid";
}

/** Green = strong, amber = watch, red = weak/avoid. */
export function toneForScore(score: number): Tone {
  const stance = stanceForScore(score);
  if (stance === "Strong") return "strong";
  if (stance === "Watch") return "watch";
  return "weak";
}

export function actionForScore(score: number): string {
  if (score >= GRADE_A_PLUS_FLOOR) {
    return "A+ rank. Size it only when a Prime or Standard trigger is active.";
  }
  if (score >= GRADE_A_FLOOR) {
    return "A rank. Wait for a Prime or Standard trigger before sizing.";
  }
  if (score >= RECOMMENDATION_FLOOR) {
    return "Watch. Keep it on the list, but wait for volume and sector strength before sizing.";
  }
  if (score >= WEAK_FLOOR) {
    return "Stand aside. Too many factors are soft for a new swing long.";
  }
  return "Avoid. True RS, sector, and the close argue against a long swing.";
}

export function scoreSecurity(security: Security): ScoredSecurity {
  const normalized = normalizeFactors(security.factors);
  const factors: FactorReading[] = FACTOR_ORDER.map((key) => ({
    key,
    label: FACTOR_LABELS[key],
    value: normalized[key],
  }));
  const conviction = scoreFactors(normalized);
  return {
    symbol: security.symbol,
    name: security.name,
    sector: security.sector,
    factors,
    conviction,
    grade: gradeForScore(conviction),
    stance: stanceForScore(conviction),
    tone: toneForScore(conviction),
    action: actionForScore(conviction),
  };
}

export function isRecommendation(scored: ScoredSecurity): scored is Recommendation {
  return scored.grade !== null;
}

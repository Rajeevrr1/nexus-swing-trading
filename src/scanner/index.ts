import { isRecommendation } from "./score";
import type { Recommendation, ScoredSecurity } from "./types";
import { resolveScanResults } from "./resolveScan";

export const SCAN_LABEL = "NSE swing-trading sample — not live market data";
export const SCAN_AS_OF = "Factor inputs for a 10 Nov 2026 NSE session";

export {
  FACTOR_LABELS,
  FACTOR_WEIGHTS,
  GRADE_A_FLOOR,
  GRADE_A_PLUS_FLOOR,
  RECOMMENDATION_FLOOR,
  WEAK_FLOOR,
  actionForScore,
  gradeForScore,
  isStrongGrade,
  isRecommendation,
  normalizeFactors,
  scoreFactors,
  scoreSecurity,
  stanceForScore,
  toneForScore,
} from "./score";

export { getUniverse } from "./universe";
export { resolveScanResults } from "./resolveScan";
export { useScanResults, useRecommendations } from "./useScanResults";

export type {
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

/** Every name in the universe scored from sample OHLCV (use `resolveScanResults` when Kite histories are available). */
export function getScanResults(): ScoredSecurity[] {
  return resolveScanResults({}, [], false);
}

/**
 * Names that cleared the recommendation floor (grade B or better),
 * highest conviction first. This is what the Recommendations tab renders.
 */
export function getRecommendations(): Recommendation[] {
  return getScanResults().filter(isRecommendation);
}

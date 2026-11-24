import { isRecommendation } from "../scanner/score";
import type { ScoredSecurity } from "../scanner/types";

export interface SectorMember {
  symbol: string;
  name: string;
  conviction: number;
  grade: ScoredSecurity["grade"];
  /** Trailing return over the lookback window; null without price history. */
  ret: number | null;
}

export interface SectorRow {
  sector: string;
  count: number;
  recommendations: number;
  avgConviction: number;
  /** Average sector-strength factor reading (0-100). */
  avgSectorFactor: number;
  /** Mean trailing return across members that have history. */
  avgReturn: number | null;
  /** Share of members whose trailing return is positive. */
  breadth: number | null;
  /** Blended 0-100 strength used for ranking. */
  strength: number;
  rank: number;
  members: SectorMember[];
}

export const RETURN_LOOKBACK = 20;

export function trailingReturn(closes: readonly number[], lookback = RETURN_LOOKBACK): number | null {
  if (closes.length <= lookback) return null;
  const last = closes[closes.length - 1];
  const base = closes[closes.length - 1 - lookback];
  return base > 0 && Number.isFinite(last) ? last / base - 1 : null;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/**
 * Ranks sectors by a blend of scanner conviction, the sector factor and, when
 * live history exists, trailing return. Return is squashed to 0-100 around 0%
 * (+/-10% maps to the ends) so one outlier cannot dominate the blend.
 */
export function buildSectorRows(
  securities: readonly ScoredSecurity[],
  returns: Readonly<Record<string, number | null>> = {},
): SectorRow[] {
  const groups = new Map<string, ScoredSecurity[]>();
  for (const security of securities) {
    const list = groups.get(security.sector) ?? [];
    list.push(security);
    groups.set(security.sector, list);
  }

  const rows: SectorRow[] = [];
  for (const [sector, list] of groups) {
    const members: SectorMember[] = list
      .map((s) => ({ symbol: s.symbol, name: s.name, conviction: s.conviction, grade: s.grade, ret: returns[s.symbol] ?? null }))
      .sort((a, b) => b.conviction - a.conviction);
    const rets = members.map((m) => m.ret).filter((r): r is number => r != null);
    const avgConviction = mean(list.map((s) => s.conviction)) ?? 0;
    const avgSectorFactor = mean(list.map((s) => s.factors.find((f) => f.key === "sector")?.value ?? 0)) ?? 0;
    const avgReturn = mean(rets);
    const retScore = avgReturn == null ? null : Math.max(0, Math.min(100, 50 + avgReturn * 500));
    const strength =
      retScore == null
        ? avgConviction * 0.6 + avgSectorFactor * 0.4
        : avgConviction * 0.4 + avgSectorFactor * 0.25 + retScore * 0.35;
    rows.push({
      sector,
      count: list.length,
      recommendations: list.filter(isRecommendation).length,
      avgConviction,
      avgSectorFactor,
      avgReturn,
      breadth: rets.length ? rets.filter((r) => r > 0).length / rets.length : null,
      strength,
      rank: 0,
      members,
    });
  }

  rows.sort((a, b) => b.strength - a.strength || a.sector.localeCompare(b.sector));
  rows.forEach((row, index) => {
    row.rank = index + 1;
  });
  return rows;
}

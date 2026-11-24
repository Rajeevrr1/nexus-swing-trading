import { resolveSecurity } from "../portfolio";
import { getUniverse } from "../scanner/universe";
import { scoreSecurity } from "../scanner/score";

/** Accepts an NSE ticker or a scanner name match. */
export function resolveWatchlistSymbol(query: string): { symbol: string; name?: string } | { error: string } {
  const trimmed = query.trim();
  if (!trimmed) return { error: "Enter an NSE symbol or company name." };
  if (/^[A-Za-z][A-Za-z0-9-]{0,24}$/.test(trimmed)) {
    return { symbol: trimmed.toUpperCase() };
  }
  const universe = getUniverse().map(scoreSecurity);
  const resolved = resolveSecurity(trimmed, universe);
  if ("error" in resolved) return { error: resolved.error };
  return { symbol: resolved.match.symbol, name: resolved.match.name };
}

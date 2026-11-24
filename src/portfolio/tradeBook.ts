import type { PriceBar } from "../analysis";
import { latestAtr } from "../analysis/indicators";
import { latestEma } from "../analysis";
import { applyMinStopDistance, initialStopLevel } from "../risk/positionSizing";

export interface TradeBookEntry {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  initialStop: number;
  quantity: number;
  source: "kite" | "added";
  /** True once a partial sell (e.g. T1 50% booking in Zerodha) reduced holding quantity. */
  t1Booked?: boolean;
}

const KEY = "nexus-trade-book";

function isEntry(value: unknown): value is TradeBookEntry {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<TradeBookEntry>;
  return (
    typeof row.symbol === "string" &&
    typeof row.entryDate === "string" &&
    typeof row.entryPrice === "number" &&
    Number.isFinite(row.entryPrice) &&
    typeof row.initialStop === "number" &&
    Number.isFinite(row.initialStop) &&
    typeof row.quantity === "number" &&
    Number.isFinite(row.quantity) &&
    (row.source === "kite" || row.source === "added")
  );
}

export function loadTradeBook(): TradeBookEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

export function saveTradeBook(entries: readonly TradeBookEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Quota or private mode: book still works for this page load.
  }
}

export function tradeBookMap(entries: readonly TradeBookEntry[]): Map<string, TradeBookEntry> {
  return new Map(entries.map((entry) => [entry.symbol, entry]));
}

/**
 * Prefer the frozen stop; otherwise compute once from bars anchored strictly under `entryPrice`
 * (at least 2.5% below cost basis) so an older winning holding never receives an initialStop above entry.
 * If the holding's quantity or average price changed (e.g. averaging in), sync the book entry safely.
 */
export function resolveFrozenStop(input: {
  symbol: string;
  entryPrice: number;
  quantity: number;
  source: "kite" | "added";
  bars?: readonly PriceBar[];
  existing?: TradeBookEntry | null;
}): { stop: number | null; upsert: TradeBookEntry | null } {
  const existing = input.existing;
  if (existing && Number.isFinite(existing.initialStop)) {
    const stopValidForEntry = !(input.entryPrice > 0) || existing.initialStop < input.entryPrice;
    const unchanged =
      stopValidForEntry &&
      Math.abs(existing.entryPrice - input.entryPrice) <= 0.01 &&
      existing.quantity === input.quantity &&
      existing.source === input.source;
    if (unchanged) {
      return { stop: existing.initialStop, upsert: null };
    }
    const adjustedStop =
      input.entryPrice > 0
        ? Number(applyMinStopDistance(input.entryPrice, Math.min(existing.initialStop, input.entryPrice)).toFixed(2))
        : existing.initialStop;
    const sameCostBasis = Math.abs(existing.entryPrice - input.entryPrice) <= 0.01;
    const partialSold = sameCostBasis && input.quantity > 0 && input.quantity < existing.quantity;
    const t1Booked = partialSold ? true : existing.t1Booked === true && input.quantity <= existing.quantity;
    return {
      stop: adjustedStop,
      upsert: {
        ...existing,
        entryPrice: input.entryPrice,
        quantity: input.quantity,
        source: input.source,
        initialStop: adjustedStop,
        ...(t1Booked ? { t1Booked: true } : { t1Booked: false }),
      },
    };
  }
  const rawBars = input.bars;
  if (!rawBars || rawBars.length < 50) return { stop: null, upsert: null };
  const bars = [...rawBars].sort((a, b) => a.date.localeCompare(b.date));
  const closes = bars.map((bar) => bar.close);
  const ema20 = latestEma(closes, 20);
  const atr14 = latestAtr(bars);
  const last = bars[bars.length - 1];
  if (ema20 == null || ema20 <= 0 || atr14 == null || atr14 <= 0 || !last) {
    return { stop: null, upsert: null };
  }
  const anchorPrice = input.entryPrice > 0 ? input.entryPrice : last.close;
  const rawStop = initialStopLevel(last, ema20, atr14);
  const stop = Number(applyMinStopDistance(anchorPrice, Math.min(rawStop, anchorPrice)).toFixed(2));
  return {
    stop,
    upsert: {
      symbol: input.symbol,
      entryDate: last.date,
      entryPrice: input.entryPrice,
      initialStop: stop,
      quantity: input.quantity,
      source: input.source,
    },
  };
}

export function upsertTradeBook(
  current: readonly TradeBookEntry[],
  next: TradeBookEntry,
): TradeBookEntry[] {
  const map = tradeBookMap(current);
  map.set(next.symbol, next);
  return [...map.values()];
}

export function pruneTradeBook(
  current: readonly TradeBookEntry[],
  openSymbols: ReadonlySet<string>,
  options: { pruneKite?: boolean; pruneAdded?: boolean } = {},
): TradeBookEntry[] {
  const pruneKite = options.pruneKite ?? true;
  const pruneAdded = options.pruneAdded ?? true;
  return current.filter((entry) => {
    if (openSymbols.has(entry.symbol)) return true;
    if (entry.source === "kite" && !pruneKite) return true;
    if (entry.source === "added" && !pruneAdded) return true;
    return false;
  });
}

export function exportTradeBookJson(entries: readonly TradeBookEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

export function importTradeBookJson(raw: string): TradeBookEntry[] | { error: string } {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return { error: "Trade book must be a JSON array." };
    const entries = parsed.filter(isEntry);
    if (entries.length === 0 && parsed.length > 0) return { error: "No valid trade-book rows found." };
    return entries;
  } catch {
    return { error: "Invalid JSON." };
  }
}

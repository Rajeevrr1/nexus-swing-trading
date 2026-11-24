/**
 * Rolling quality monitor for closed Standard trades only.
 * Prime trades are never stored. This module does not change triggers
 * or the quality floor — it only records, measures, and warns.
 */

/** Closed Standard trades kept on disk. Metrics use a shorter window of this book. */
export const STANDARD_HISTORY_LIMIT = 50;
/** Rolling window for win rate, average R, expectancy, and profit factor. */
export const STANDARD_METRICS_WINDOW = 30;
/** Minimum closed Standard trades required before negative expectancy triggers a floor warning. */
export const STANDARD_WARNING_MIN_SAMPLE = 10;

export const STANDARD_PERFORMANCE_EVENT = "nexus-standard-performance";
const STORAGE_KEY = "nexus-standard-performance";

export const STANDARD_WARNING_MESSAGE =
  "Standard expectancy negative over last 30 trades. Consider raising quality floor to 55.";

export interface StandardClosedTrade {
  id: string;
  symbol: string;
  entryDate: string;
  exitDate: string;
  /** Null when the journal row had no usable stop. */
  rMultiple: number | null;
  /** Exit vs entry, as a fraction (0.02 = +2%). */
  pnlPercent: number;
  result: "win" | "loss";
}

export interface StandardRollingMetrics {
  /** Trades inside the metrics window (at most STANDARD_METRICS_WINDOW). */
  sample: number;
  winRate: number | null;
  avgR: number | null;
  /** Average P&L % over the window. */
  expectancy: number | null;
  profitFactor: number | null;
}

export interface StandardPerformanceSnapshot {
  /** Oldest first, newest last. Capped at STANDARD_HISTORY_LIMIT. */
  history: StandardClosedTrade[];
  metrics: StandardRollingMetrics;
  standardPerformanceWarning: boolean;
  warningMessage: string | null;
}

const EMPTY_METRICS: StandardRollingMetrics = {
  sample: 0,
  winRate: null,
  avgR: null,
  expectancy: null,
  profitFactor: null,
};

function isClosedStandard(value: unknown): value is StandardClosedTrade {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  const num = (item: unknown) => typeof item === "number" && Number.isFinite(item);
  return (
    typeof row.id === "string" &&
    typeof row.symbol === "string" &&
    typeof row.entryDate === "string" &&
    typeof row.exitDate === "string" &&
    (row.rMultiple === null || num(row.rMultiple)) &&
    num(row.pnlPercent) &&
    (row.result === "win" || row.result === "loss")
  );
}

/** Last `window` trades, oldest first. Fewer than `window` uses the whole book. */
export function metricsWindow(history: readonly StandardClosedTrade[], window = STANDARD_METRICS_WINDOW): StandardClosedTrade[] {
  if (history.length <= window) return [...history];
  return history.slice(history.length - window);
}

export function rollingStandardMetrics(history: readonly StandardClosedTrade[]): StandardRollingMetrics {
  const rows = metricsWindow(history);
  if (rows.length === 0) return { ...EMPTY_METRICS };
  const wins = rows.filter((row) => row.result === "win");
  const grossProfit = rows.reduce((sum, row) => sum + (row.pnlPercent > 0 ? row.pnlPercent : 0), 0);
  const grossLoss = Math.abs(rows.reduce((sum, row) => sum + (row.pnlPercent < 0 ? row.pnlPercent : 0), 0));
  const rValues = rows.map((row) => row.rMultiple).filter((value): value is number => value != null);
  return {
    sample: rows.length,
    winRate: wins.length / rows.length,
    avgR: rValues.length === 0 ? null : rValues.reduce((sum, value) => sum + value, 0) / rValues.length,
    expectancy: rows.reduce((sum, row) => sum + row.pnlPercent, 0) / rows.length,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : wins.length > 0 ? null : 0,
  };
}

export function evaluateStandardWarning(
  metrics: StandardRollingMetrics,
  minSample = STANDARD_WARNING_MIN_SAMPLE,
): {
  standardPerformanceWarning: boolean;
  warningMessage: string | null;
} {
  const standardPerformanceWarning =
    metrics.sample >= minSample && metrics.expectancy != null && metrics.expectancy < 0;
  return {
    standardPerformanceWarning,
    warningMessage: standardPerformanceWarning ? STANDARD_WARNING_MESSAGE : null,
  };
}

export function snapshotFromHistory(history: readonly StandardClosedTrade[]): StandardPerformanceSnapshot {
  const metrics = rollingStandardMetrics(history);
  return { history: [...history], metrics, ...evaluateStandardWarning(metrics) };
}

/** Drop a duplicate id, append, and keep the newest STANDARD_HISTORY_LIMIT closes. */
export function appendStandardTrade(
  history: readonly StandardClosedTrade[],
  trade: StandardClosedTrade,
): StandardClosedTrade[] {
  const next = history.filter((row) => row.id !== trade.id);
  next.push(trade);
  return next.length > STANDARD_HISTORY_LIMIT ? next.slice(next.length - STANDARD_HISTORY_LIMIT) : next;
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadStandardHistory(): StandardClosedTrade[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const rows = parsed.filter(isClosedStandard);
    return rows.length > STANDARD_HISTORY_LIMIT ? rows.slice(rows.length - STANDARD_HISTORY_LIMIT) : rows;
  } catch {
    return [];
  }
}

function saveStandardHistory(history: readonly StandardClosedTrade[]): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Quota or private mode: the in-memory snapshot for this call is still returned.
  }
}

export function readStandardPerformance(): StandardPerformanceSnapshot {
  return snapshotFromHistory(loadStandardHistory());
}

/**
 * Record one closed Standard trade and refresh the warning.
 * Callers must not pass Prime trades. A repeat id replaces the earlier row.
 * The warning is logged only when expectancy crosses below zero.
 */
export function recordClosedStandardTrade(trade: StandardClosedTrade): StandardPerformanceSnapshot {
  const before = rollingStandardMetrics(loadStandardHistory());
  const beforeWarn = evaluateStandardWarning(before).standardPerformanceWarning;
  const history = appendStandardTrade(loadStandardHistory(), trade);
  saveStandardHistory(history);
  const snapshot = snapshotFromHistory(history);
  const turnedNegative = !beforeWarn && snapshot.standardPerformanceWarning;
  if (turnedNegative) {
    console.warn(`[NEXUS] ${snapshot.warningMessage}`);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(STANDARD_PERFORMANCE_EVENT));
  }
  return snapshot;
}

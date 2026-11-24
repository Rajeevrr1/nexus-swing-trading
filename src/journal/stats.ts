export interface JournalTrade {
  id: string;
  symbol: string;
  entryDate: string;
  entryPrice: number;
  qty: number;
  stopPrice: number | null;
  exitDate: string | null;
  exitPrice: number | null;
  note: string;
  /** Desk tier at the time the trade was logged. Prime is ignored by the Standard monitor. */
  triggerTier?: "prime" | "standard" | null;
}

export interface TradeResult {
  pnl: number;
  pnlPercent: number;
  /** Multiple of initial risk; null when no valid stop was logged. */
  rMultiple: number | null;
  holdDays: number | null;
}

export interface JournalStats {
  closed: number;
  open: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalPnl: number;
  avgWin: number | null;
  avgLoss: number | null;
  /** Gross profit divided by gross loss; null when there are no losses yet. */
  profitFactor: number | null;
  expectancy: number | null;
  avgR: number | null;
  best: number | null;
  worst: number | null;
  avgHoldDays: number | null;
}

export function isClosed(trade: JournalTrade): boolean {
  return trade.exitPrice != null && trade.exitDate != null;
}

export function tradeResult(trade: JournalTrade, exitPrice: number | null = trade.exitPrice): TradeResult | null {
  if (exitPrice == null || trade.entryPrice <= 0 || trade.qty <= 0) return null;
  const pnl = (exitPrice - trade.entryPrice) * trade.qty;
  const pnlPercent = (exitPrice - trade.entryPrice) / trade.entryPrice;
  const riskPerShare = trade.stopPrice != null ? trade.entryPrice - trade.stopPrice : 0;
  const rMultiple = riskPerShare > 0 ? (exitPrice - trade.entryPrice) / riskPerShare : null;
  let holdDays: number | null = null;
  if (trade.exitDate) {
    const days = (Date.parse(trade.exitDate) - Date.parse(trade.entryDate)) / 86_400_000;
    holdDays = Number.isFinite(days) && days >= 0 ? Math.round(days) : null;
  }
  return { pnl, pnlPercent, rMultiple, holdDays };
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function computeStats(trades: readonly JournalTrade[]): JournalStats {
  const closedTrades = trades.filter(isClosed);
  const results = closedTrades.map((trade) => tradeResult(trade)).filter((r): r is TradeResult => r != null);
  const winners = results.filter((r) => r.pnl > 0);
  const losers = results.filter((r) => r.pnl < 0);
  const grossProfit = winners.reduce((sum, r) => sum + r.pnl, 0);
  const grossLoss = Math.abs(losers.reduce((sum, r) => sum + r.pnl, 0));
  const totalPnl = results.reduce((sum, r) => sum + r.pnl, 0);
  const pnls = results.map((r) => r.pnl);
  return {
    closed: results.length,
    open: trades.length - closedTrades.length,
    wins: winners.length,
    losses: losers.length,
    winRate: results.length ? winners.length / results.length : null,
    totalPnl,
    avgWin: mean(winners.map((r) => r.pnl)),
    avgLoss: mean(losers.map((r) => r.pnl)),
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    expectancy: results.length ? totalPnl / results.length : null,
    avgR: mean(results.map((r) => r.rMultiple).filter((r): r is number => r != null)),
    best: pnls.length ? Math.max(...pnls) : null,
    worst: pnls.length ? Math.min(...pnls) : null,
    avgHoldDays: mean(results.map((r) => r.holdDays).filter((d): d is number => d != null)),
  };
}

export type TradeDraftError = string;

export interface TradeDraft {
  symbol: string;
  entryDate: string;
  entryPrice: string;
  qty: string;
  stopPrice: string;
  note: string;
}

/** Validates form input; returns a trade (without id) or a user-facing error. */
export function parseDraft(draft: TradeDraft): Omit<JournalTrade, "id"> | { error: TradeDraftError } {
  const symbol = draft.symbol.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9&-]{0,24}$/.test(symbol)) return { error: "Enter a valid NSE symbol, e.g. INFY." };
  const entryPrice = Number(draft.entryPrice);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return { error: "Entry price must be greater than 0." };
  const qty = Number(draft.qty);
  if (!Number.isInteger(qty) || qty <= 0) return { error: "Quantity must be a whole number greater than 0." };
  if (!draft.entryDate || Number.isNaN(Date.parse(draft.entryDate))) return { error: "Pick an entry date." };
  let stopPrice: number | null = null;
  if (draft.stopPrice.trim() !== "") {
    stopPrice = Number(draft.stopPrice);
    if (!Number.isFinite(stopPrice) || stopPrice <= 0 || stopPrice >= entryPrice) {
      return { error: "Stop must be above 0 and below the entry price." };
    }
  }
  return {
    symbol,
    entryDate: draft.entryDate,
    entryPrice,
    qty,
    stopPrice,
    exitDate: null,
    exitPrice: null,
    note: draft.note.trim().slice(0, 280),
  };
}

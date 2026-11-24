import type { KiteHolding } from "../market/kiteClient";
import type { HoldingInput } from "../portfolio";

export interface PortfolioSummary {
  holdingsCount: number;
  invested: number;
  currentValue: number;
  pnl: number;
  pnlPercent: number;
  live: boolean;
}

/** Totals from the Kite book plus session-added names when quotes are live. */
export function portfolioSummary(input: {
  connected: boolean;
  holdings: readonly KiteHolding[];
  added: readonly HoldingInput[];
  quotes: Record<string, { lastPrice: number }>;
}): PortfolioSummary {
  const kiteSymbols = new Set(input.holdings.map((holding) => holding.symbol));
  let invested = 0;
  let currentValue = 0;
  let count = 0;

  if (input.connected) {
    for (const holding of input.holdings) {
      const quote = input.quotes[holding.symbol];
      const last = quote && Number.isFinite(quote.lastPrice) ? quote.lastPrice : holding.lastPrice;
      const cost = holding.averagePrice * holding.quantity;
      const value = last * holding.quantity;
      invested += cost;
      currentValue += value;
      count += 1;
    }
    for (const holding of input.added) {
      if (kiteSymbols.has(holding.symbol)) continue;
      const quote = input.quotes[holding.symbol];
      const last = quote?.lastPrice ?? holding.entry;
      invested += holding.entry * holding.quantity;
      currentValue += last * holding.quantity;
      count += 1;
    }
  }

  const pnl = currentValue - invested;
  const pnlPercent = invested > 0 ? pnl / invested : 0;
  return {
    holdingsCount: count,
    invested,
    currentValue,
    pnl,
    pnlPercent,
    live: input.connected && count > 0,
  };
}

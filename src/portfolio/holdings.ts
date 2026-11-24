import { buildAnalysis, formatInr, type PriceBar } from "../analysis";
import type { ScoredSecurity } from "../scanner";
import { positionSignal, type PositionSignal } from "./signal";

export interface HoldingInput {
  symbol: string;
  entry: number;
  quantity: number;
  source: "sample" | "added";
}

export interface PositionRow {
  symbol: string;
  name: string;
  sector: string;
  entry: number;
  quantity: number;
  lastClose: number;
  ema20: number;
  trueRs: number | null;
  pnl: number;
  pnlPercent: number;
  signal: PositionSignal;
  source: "sample" | "kite" | "added";
  exchange: string;
  priceSource: "live" | "sample";
  emaSource: "live" | "sample";
  initialStopLoss?: number | null;
  /** Stored trade-book date. The protective stop and the 10-session exit use it. */
  entryDate?: string | null;
}

export interface MarketOverlay {
  lastPrice?: number;
  ema20?: number;
  bars?: readonly PriceBar[];
}

/** Sample book. Entries are chosen so the EMA and True RS rules show every signal. */
export const SAMPLE_HOLDINGS: readonly HoldingInput[] = [
  { symbol: "RELIANCE", entry: 1420, quantity: 25, source: "sample" },
  { symbol: "HDFCBANK", entry: 1690, quantity: 20, source: "sample" },
  { symbol: "WIPRO", entry: 430, quantity: 50, source: "sample" },
  { symbol: "SBIN", entry: 790, quantity: 40, source: "sample" },
  { symbol: "TATAMOTORS", entry: 760, quantity: 35, source: "sample" },
  { symbol: "INFY", entry: 1790, quantity: 15, source: "sample" },
  { symbol: "TITAN", entry: 3120, quantity: 10, source: "sample" },
];

export function resolveSecurity(
  query: string,
  universe: readonly ScoredSecurity[],
): { match: ScoredSecurity } | { error: string } {
  const trimmed = query.trim();
  if (!trimmed) return { error: "Enter an NSE symbol or company name." };
  const normalized = trimmed.toUpperCase().replace(/\s+/g, "");
  const exactSymbol = universe.find((security) => security.symbol === normalized);
  if (exactSymbol) {
    return { match: exactSymbol };
  }
  const lower = trimmed.toLowerCase();
  const exactName = universe.filter(
    (security) => security.name.toLowerCase() === lower || security.symbol.toLowerCase() === lower,
  );
  if (exactName.length === 1) return { match: exactName[0] };
  const partial = universe.filter(
    (security) =>
      security.name.toLowerCase().includes(lower) || security.symbol.toLowerCase().includes(lower),
  );
  if (partial.length === 1) return { match: partial[0] };
  if (partial.length > 1) {
    return { error: `Several matches: ${partial.map((security) => security.symbol).join(", ")}. Use the symbol.` };
  }
  return { error: `${trimmed} is not in the Nifty 100 universe.` };
}

export function buildPosition(holding: HoldingInput, security: ScoredSecurity): PositionRow | null {
  if (!(holding.entry > 0) || !(holding.quantity > 0)) return null;
  const analysis = buildAnalysis(security);
  const trueRs = security.factors.find((factor) => factor.key === "trueRs")?.value ?? 0;
  const pnlPerShare = analysis.lastClose - holding.entry;
  return {
    symbol: security.symbol,
    name: security.name,
    sector: security.sector,
    entry: holding.entry,
    quantity: holding.quantity,
    lastClose: analysis.lastClose,
    ema20: analysis.ema20Last,
    trueRs,
    pnl: pnlPerShare * holding.quantity,
    pnlPercent: pnlPerShare / holding.entry,
    signal: positionSignal({
      lastClose: analysis.lastClose,
      ema20: analysis.ema20Last,
      trueRs,
      entry: holding.entry,
      bars: analysis.bars,
    }),
    source: holding.source,
    priceSource: "sample",
    emaSource: "sample",
    exchange: "NSE",
    initialStopLoss: null,
  };
}

export function buildLivePosition(input: {
  symbol: string;
  name: string;
  exchange: string;
  entry: number;
  quantity: number;
  lastPrice: number | null;
  ema20: number | null;
  trueRs: number | null;
  bars?: readonly PriceBar[];
  niftyBars?: readonly PriceBar[];
  source: "kite" | "added";
  sector?: string;
  initialStopLoss?: number | null;
  entryDate?: string | null;
  t1Booked?: boolean;
}): PositionRow {
  const lastClose = input.lastPrice ?? input.entry;
  const priced = input.lastPrice != null && Number.isFinite(input.lastPrice);
  const pnlPerShare = priced ? input.lastPrice! - input.entry : 0;
  const initialStopLoss = input.initialStopLoss ?? null;
  return {
    symbol: input.symbol,
    name: input.name,
    sector: input.sector ?? input.exchange,
    entry: input.entry,
    quantity: input.quantity,
    lastClose: priced ? input.lastPrice! : lastClose,
    ema20: input.ema20 ?? 0,
    trueRs: input.trueRs,
    pnl: priced ? pnlPerShare * input.quantity : 0,
    pnlPercent: priced && input.entry > 0 ? pnlPerShare / input.entry : 0,
    signal: positionSignal({
      lastClose: priced ? input.lastPrice! : input.entry,
      ema20: input.ema20,
      trueRs: input.trueRs,
      entry: input.entry,
      bars: input.bars,
      niftyBars: input.niftyBars,
      initialStopLoss,
      entryDate: input.entryDate,
      t1Booked: input.t1Booked,
    }),
    source: input.source,
    priceSource: priced ? "live" : "sample",
    emaSource: input.ema20 != null ? "live" : "sample",
    exchange: input.exchange,
    initialStopLoss,
    entryDate: input.entryDate ?? null,
  };
}

/** Live last price updates P&L. The exit signal switches only when EMA 20 is live too. */
export function withMarket(row: PositionRow, overlay: MarketOverlay): PositionRow {
  const priceLive = overlay.lastPrice != null && Number.isFinite(overlay.lastPrice);
  const emaLive = overlay.ema20 != null && Number.isFinite(overlay.ema20);
  const lastClose = priceLive ? overlay.lastPrice! : row.lastClose;
  const ema20 = emaLive ? overlay.ema20! : row.ema20;
  const pnlPerShare = lastClose - row.entry;
  return {
    ...row,
    lastClose,
    ema20,
    pnl: pnlPerShare * row.quantity,
    pnlPercent: row.entry > 0 ? pnlPerShare / row.entry : 0,
    signal:
      priceLive && emaLive
        ? positionSignal({
            lastClose,
            ema20,
            trueRs: row.trueRs,
            entry: row.entry,
            bars: overlay.bars ?? undefined,
            initialStopLoss: row.initialStopLoss,
            entryDate: row.entryDate,
          })
        : row.signal,
    priceSource: priceLive ? "live" : "sample",
    emaSource: emaLive ? "live" : "sample",
  };
}

export function mergeHoldings(added: readonly HoldingInput[]): HoldingInput[] {
  const bySymbol = new Map<string, HoldingInput>();
  for (const holding of SAMPLE_HOLDINGS) bySymbol.set(holding.symbol, holding);
  for (const holding of added) bySymbol.set(holding.symbol, holding);
  return [...bySymbol.values()];
}

export function listPositions(
  added: readonly HoldingInput[],
  universe: readonly ScoredSecurity[],
): PositionRow[] {
  const bySymbol = new Map(universe.map((security) => [security.symbol, security]));
  return mergeHoldings(added).flatMap((holding) => {
    const security = bySymbol.get(holding.symbol);
    if (!security) return [];
    const row = buildPosition(holding, security);
    return row ? [row] : [];
  });
}

export function formatSignedInr(value: number): string {
  const body = formatInr(Math.abs(value));
  if (value < 0) return `−${body}`;
  if (value > 0) return `+${body}`;
  return body;
}

export function formatPercent(value: number): string {
  const pct = value * 100;
  const text = `${Math.abs(pct).toFixed(1)}%`;
  if (pct < 0) return `−${text}`;
  if (pct > 0) return `+${text}`;
  return text;
}

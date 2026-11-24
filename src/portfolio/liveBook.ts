import { latestEma, type PriceBar } from "../analysis";
import type { KiteHolding, LiveQuote } from "../market/kiteClient";
import type { ScoredSecurity } from "../scanner";
import {
  evaluateTranchePlan,
  isDeadMoneyTimeExit,
  peakHighSinceEntry,
  sessionsHeld,
  TRANCHE_T1_GAIN,
} from "../strategy/policy";
import { buildLivePosition, type HoldingInput, type PositionRow } from "./holdings";
import { evaluatePortfolioTechnicals, type TechnicalAnalysisSummary } from "./technicals";
import {
  loadTradeBook,
  pruneTradeBook,
  resolveFrozenStop,
  saveTradeBook,
  tradeBookMap,
  upsertTradeBook,
  type TradeBookEntry,
} from "./tradeBook";

export interface TrancheStatus {
  name: string;
  quantity: number;
  action: "hold" | "book" | "exit" | "trail";
  label: string;
  tone: "strong" | "watch" | "weak";
  detail: string;
}

export interface TranchePlan {
  t1: TrancheStatus;
  t2: TrancheStatus;
  summary: string;
  lockedProfitPerShare: number | null;
  runnerStopLevel: number | null;
}

export interface LiveBookRow extends PositionRow {
  quoteMissing: boolean;
  t1Quantity: number;
  tranchePlan: TranchePlan;
  technicals: TechnicalAnalysisSummary;
  /** Sessions after the stored entry date. Null when that date is not in the bars. */
  sessionsHeld: number | null;
  /** True once the position has been held 10 sessions. The signal is a full exit. */
  holdReview: boolean;
}

/**
 * Live 50/50 Tranche plan aligned with v1.4 policy:
 * T1 locks 50% at +6% and raises protective stop to +1.5%; T2 trails remaining 50% on EMA 20.
 */
export function computeTranchePlan(input: {
  entry: number;
  quantity: number;
  lastClose: number;
  ema20: number | null;
  bars?: readonly PriceBar[];
  initialStopLoss?: number | null;
  entryDate?: string | null;
  t1Booked?: boolean;
}): TranchePlan {
  const t1Qty = input.t1Booked ? 0 : Math.max(1, Math.ceil(input.quantity / 2));
  const t2Qty = input.t1Booked ? input.quantity : Math.max(0, input.quantity - t1Qty);
  const decision = evaluateTranchePlan(input);
  return {
    t1: {
      name: "T1 Lock (50%)",
      quantity: t1Qty,
      action: decision.t1.action,
      label: decision.t1.label,
      tone: decision.t1.tone,
      detail: decision.t1.detail,
    },
    t2: {
      name: "T2 Runner (50%)",
      quantity: t2Qty,
      action: decision.t2.action,
      label: decision.t2.label,
      tone: decision.t2.tone,
      detail: decision.t2.detail,
    },
    summary: decision.summary,
    lockedProfitPerShare: decision.lockedProfitPerShare,
    runnerStopLevel: decision.runnerStopLevel,
  };
}

function scannerRs(
  symbol: string,
  scan: readonly ScoredSecurity[] = [],
): { name: string; trueRs: number | null; sector: string } {
  const security = scan.find((item) => item.symbol === symbol);
  if (!security) return { name: symbol, trueRs: null, sector: "NSE" };
  const trueRs = security.factors.find((factor) => factor.key === "trueRs")?.value ?? null;
  return { name: security.name, trueRs, sector: security.sector };
}

function emaFrom(bars: PriceBar[] | undefined): number | null {
  if (!bars || bars.length < 20) return null;
  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  return latestEma(
    sorted.map((bar) => bar.close),
    20,
  );
}

/** The same live book the Portfolio tab renders. Alerts use this so they match the signals. */
export function liveBookPositions(input: {
  connected: boolean;
  holdings: readonly KiteHolding[];
  added: readonly HoldingInput[];
  histories: Record<string, PriceBar[]>;
  quotes: Record<string, LiveQuote>;
  niftyBars?: readonly PriceBar[];
  scan?: readonly ScoredSecurity[];
  tradeBook?: readonly TradeBookEntry[];
  /** True only when Kite holdings have finished loading without error. Prevents wiping stops on mount/disconnect. */
  holdingsLoaded?: boolean;
  /** Set false during pure render passes and persist via useEffect instead. */
  persist?: boolean;
}): LiveBookRow[] {
  const scan = input.scan ?? [];
  const initialBook = input.tradeBook ?? loadTradeBook();
  let book = [...initialBook];
  const bookBySymbol = tradeBookMap(book);
  const openSymbols = new Set<string>();
  const kiteSymbols = new Set(input.connected ? input.holdings.map((holding) => holding.symbol) : []);

  const kiteRows = (input.connected ? input.holdings : []).map((holding) => {
    openSymbols.add(holding.symbol);
    const known = scannerRs(holding.symbol, scan);
    const bars = input.histories[holding.symbol];
    const fast = emaFrom(bars);
    const quotePrice = input.quotes[holding.symbol]?.lastPrice;
    const lastClose =
      quotePrice != null && Number.isFinite(quotePrice) ? quotePrice : holding.lastPrice;
    const resolved = resolveFrozenStop({
      symbol: holding.symbol,
      entryPrice: holding.averagePrice,
      quantity: holding.quantity,
      source: "kite",
      bars,
      existing: bookBySymbol.get(holding.symbol) ?? null,
    });
    if (resolved.upsert) {
      book = upsertTradeBook(book, resolved.upsert);
      bookBySymbol.set(holding.symbol, resolved.upsert);
    }
    const initialStop = resolved.stop;
    const bookEntry = bookBySymbol.get(holding.symbol);
    const entryDate = bookEntry?.entryDate ?? null;
    const t1Booked = Boolean(bookEntry?.t1Booked);
    const heldSessions = sessionsHeld(bars, entryDate);
    const openGain = holding.averagePrice > 0 ? (lastClose - holding.averagePrice) / holding.averagePrice : 0;
    const peak = peakHighSinceEntry(bars, entryDate);
    const t1Reached = t1Booked || (peak != null && holding.averagePrice > 0 && peak >= holding.averagePrice * (1 + TRANCHE_T1_GAIN));
    const tranchePlan = computeTranchePlan({
      entry: holding.averagePrice,
      quantity: holding.quantity,
      lastClose,
      ema20: fast,
      bars,
      initialStopLoss: initialStop,
      entryDate,
      t1Booked,
    });
    const technicals = evaluatePortfolioTechnicals({
      symbol: holding.symbol,
      entry: holding.averagePrice,
      quantity: holding.quantity,
      lastClose,
      ema20: fast,
      bars,
      niftyBars: input.niftyBars,
      initialStopLoss: initialStop,
      entryDate,
      tranchePlan,
      t1Booked,
    });
    return {
      ...buildLivePosition({
        symbol: holding.symbol,
        name: known.name,
        exchange: holding.exchange,
        entry: holding.averagePrice,
        quantity: holding.quantity,
        lastPrice: lastClose,
        ema20: fast,
        trueRs: known.trueRs,
        bars,
        niftyBars: input.niftyBars,
        source: "kite",
        sector: known.sector,
        initialStopLoss: initialStop,
        entryDate,
        t1Booked,
      }),
      quoteMissing: false,
      t1Quantity: holding.t1Quantity,
      tranchePlan,
      technicals,
      sessionsHeld: heldSessions,
      holdReview: heldSessions != null && isDeadMoneyTimeExit(heldSessions, openGain, t1Reached),
    };
  });

  const manualRows = input.added
    .filter((holding) => !kiteSymbols.has(holding.symbol))
    .map((holding) => {
      openSymbols.add(holding.symbol);
      const known = scannerRs(holding.symbol, scan);
      const lastPrice = input.connected ? (input.quotes[holding.symbol]?.lastPrice ?? null) : null;
      const bars = input.connected ? input.histories[holding.symbol] : undefined;
      const fast = input.connected ? emaFrom(bars) : null;
      const resolved = resolveFrozenStop({
        symbol: holding.symbol,
        entryPrice: holding.entry,
        quantity: holding.quantity,
        source: "added",
        bars,
        existing: bookBySymbol.get(holding.symbol) ?? null,
      });
      if (resolved.upsert) {
        book = upsertTradeBook(book, resolved.upsert);
        bookBySymbol.set(holding.symbol, resolved.upsert);
      }
      const initialStop = resolved.stop;
      const bookEntry = bookBySymbol.get(holding.symbol);
      const entryDate = bookEntry?.entryDate ?? null;
      const t1Booked = Boolean(bookEntry?.t1Booked);
      const heldSessions = sessionsHeld(bars, entryDate);
      const effectiveClose = lastPrice ?? holding.entry;
      const openGain = holding.entry > 0 ? (effectiveClose - holding.entry) / holding.entry : 0;
      const peak = peakHighSinceEntry(bars, entryDate);
      const t1Reached = t1Booked || (peak != null && holding.entry > 0 && peak >= holding.entry * (1 + TRANCHE_T1_GAIN));
      const tranchePlan = computeTranchePlan({
        entry: holding.entry,
        quantity: holding.quantity,
        lastClose: effectiveClose,
        ema20: fast,
        bars,
        initialStopLoss: initialStop,
        entryDate,
        t1Booked,
      });
      const technicals = evaluatePortfolioTechnicals({
        symbol: holding.symbol,
        entry: holding.entry,
        quantity: holding.quantity,
        lastClose: effectiveClose,
        ema20: fast,
        bars,
        niftyBars: input.connected ? input.niftyBars : undefined,
        initialStopLoss: initialStop,
        entryDate,
        tranchePlan,
        t1Booked,
      });
      return {
        ...buildLivePosition({
          symbol: holding.symbol,
          name: known.name,
          exchange: "NSE",
          entry: holding.entry,
          quantity: holding.quantity,
          lastPrice,
          ema20: fast,
          trueRs: known.trueRs,
          bars,
          niftyBars: input.connected ? input.niftyBars : undefined,
          source: "added",
          sector: known.sector,
          initialStopLoss: initialStop,
          entryDate,
          t1Booked,
        }),
        quoteMissing: lastPrice == null,
        t1Quantity: 0,
        tranchePlan,
        technicals,
        sessionsHeld: heldSessions,
        holdReview: heldSessions != null && isDeadMoneyTimeExit(heldSessions, openGain, t1Reached),
      };
    });

  const pruneKite = Boolean(input.connected && input.holdingsLoaded !== false);
  const pruned = pruneTradeBook(book, openSymbols, { pruneKite, pruneAdded: true });
  if (
    input.persist !== false &&
    typeof window !== "undefined" &&
    JSON.stringify(pruned) !== JSON.stringify(initialBook)
  ) {
    saveTradeBook(pruned);
  }

  return [...kiteRows, ...manualRows];
}

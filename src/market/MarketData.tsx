import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PriceBar } from "../analysis";
import { getUniverse } from "../scanner";
import { UNQUOTED_SYMBOLS } from "../scanner/universe";
import {
  fetchKiteHistory,
  fetchKiteHistoryPairs,
  fetchKiteHoldings,
  fetchKiteQuotes,
  fetchKiteStatus,
  KiteAuthError,
  logoutKite,
  saveKiteCredentials,
  type KiteHolding,
  type KiteStatus,
  type LiveQuote,
} from "./kiteClient";
import { type AutoRefreshOption, loadAutoRefreshMs, saveAutoRefreshMs } from "./autoRefresh";
import { marketStatus } from "./status";
import { morningRefreshDue, nextMorningRefresh } from "./schedule";

interface MarketDataValue {
  status: KiteStatus;
  mode: "live" | "sample";
  quotes: Record<string, LiveQuote>;
  histories: Record<string, PriceBar[]>;
  niftyBars: PriceBar[];
  holdings: KiteHolding[];
  holdingsError: string | null;
  loading: boolean;
  error: string | null;
  missingSymbols: string[];
  needsReconnect: boolean;
  lastRefreshAt: string | null;
  autoRefreshMs: AutoRefreshOption;
  setAutoRefreshMs: (value: AutoRefreshOption) => void;
  quotesPolling: boolean;
  refresh: () => Promise<void>;
  refreshQuotes: () => Promise<void>;
  login: () => void;
  logout: () => Promise<void>;
  saveCredentials: (apiKey: string, apiSecret: string) => Promise<void>;
}

const MarketDataContext = createContext<MarketDataValue | null>(null);

const SYMBOLS = getUniverse().map((security) => security.symbol);

const EMPTY_STATUS: KiteStatus = {
  configured: false,
  connected: false,
  expired: false,
  userName: null,
  userId: null,
  redirectUrl: "http://127.0.0.1:8000/api/v1/broker/kite/callback",
  lastRefreshAt: null,
  expiresAt: null,
};

const RECONNECT_MESSAGE = "Kite session expired. Reconnect to load today's NSE prices.";

export function MarketDataProvider({
  children,
  extraQuoteSymbols = [],
}: {
  children: ReactNode;
  extraQuoteSymbols?: readonly string[];
}) {
  const [status, setStatus] = useState<KiteStatus | null>(null);
  const [quotes, setQuotes] = useState<Record<string, LiveQuote>>({});
  const [histories, setHistories] = useState<Record<string, PriceBar[]>>({});
  const [niftyBars, setNiftyBars] = useState<PriceBar[]>([]);
  const [holdings, setHoldings] = useState<KiteHolding[]>([]);
  const [holdingsError, setHoldingsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingSymbols, setMissingSymbols] = useState<string[]>([]);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const lastRefreshRef = useRef<number | null>(null);
  const inFlight = useRef(false);
  const quoteInFlight = useRef(false);
  const holdingsRef = useRef<KiteHolding[]>([]);
  const statusRef = useRef<KiteStatus | null>(null);
  const extraSymbolsRef = useRef<readonly string[]>(extraQuoteSymbols);
  const [autoRefreshMs, setAutoRefreshMsState] = useState<AutoRefreshOption>(() => loadAutoRefreshMs());
  const [quotesPolling, setQuotesPolling] = useState(false);
  extraSymbolsRef.current = extraQuoteSymbols;
  holdingsRef.current = holdings;

  const rememberRefresh = useCallback((iso: string | null) => {
    setLastRefreshAt(iso);
    lastRefreshRef.current = iso ? Date.parse(iso) : null;
  }, []);

  const setAutoRefreshMs = useCallback((value: AutoRefreshOption) => {
    setAutoRefreshMsState(value);
    saveAutoRefreshMs(value);
  }, []);

  const quoteSymbolList = useCallback((): string[] => {
    return [...new Set([...SYMBOLS, ...extraSymbolsRef.current, ...holdingsRef.current.map((row) => row.symbol), "NIFTY"])].filter(
      (symbol) => !UNQUOTED_SYMBOLS.has(symbol),
    );
  }, []);

  const refreshQuotes = useCallback(async () => {
    if (inFlight.current || quoteInFlight.current) return;
    if (!statusRef.current?.connected) return;
    quoteInFlight.current = true;
    setQuotesPolling(true);
    try {
      const quoteResult = await fetchKiteQuotes(quoteSymbolList());
      setQuotes((current) => {
        const next = { ...current };
        for (const quote of quoteResult.quotes) next[quote.symbol] = quote;
        return next;
      });
      const missing = quoteResult.missing.filter((symbol) => !UNQUOTED_SYMBOLS.has(symbol));
      setMissingSymbols(missing);
      if (quoteResult.refreshedAt) rememberRefresh(quoteResult.refreshedAt);
    } catch (caught) {
      if (caught instanceof KiteAuthError) {
        setNeedsReconnect(true);
        setStatus((current) =>
          current ? { ...current, connected: false, expired: true, userName: null, userId: null, expiresAt: null } : current,
        );
        setError(RECONNECT_MESSAGE);
      }
    } finally {
      quoteInFlight.current = false;
      setQuotesPolling(false);
    }
  }, [quoteSymbolList, rememberRefresh]);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const nextStatus = await fetchKiteStatus();
      setStatus(nextStatus);
      statusRef.current = nextStatus;
      if (nextStatus.lastRefreshAt) rememberRefresh(nextStatus.lastRefreshAt);
      if (!nextStatus.connected) {
        setQuotes({});
        setHistories({});
        setNiftyBars([]);
        setHoldings([]);
        setHoldingsError(null);
        setMissingSymbols([]);
        if (nextStatus.expired) {
          setNeedsReconnect(true);
          setError(RECONNECT_MESSAGE);
        }
        return;
      }
      setNeedsReconnect(false);
      let holdingRows: KiteHolding[] = [];
      try {
        holdingRows = await fetchKiteHoldings();
        setHoldings(holdingRows);
        setHoldingsError(null);
      } catch (caught) {
        if (caught instanceof KiteAuthError) throw caught;
        setHoldings([]);
        setHoldingsError(caught instanceof Error ? caught.message : "Kite holdings request failed.");
      }
      const quoteSymbols = [
        ...new Set([...SYMBOLS, ...extraSymbolsRef.current, ...holdingRows.map((row) => row.symbol), "NIFTY"]),
      ].filter((symbol) => !UNQUOTED_SYMBOLS.has(symbol));
      const quoteResult = await fetchKiteQuotes(quoteSymbols);
      const quoteMap: Record<string, LiveQuote> = {};
      for (const quote of quoteResult.quotes) quoteMap[quote.symbol] = quote;
      setQuotes(quoteMap);
      const missing = quoteResult.missing.filter((symbol) => !UNQUOTED_SYMBOLS.has(symbol));
      setMissingSymbols(missing);
      if (quoteResult.refreshedAt) rememberRefresh(quoteResult.refreshedAt);
      if (quoteResult.quotes.length === 0) {
        setError("Kite is connected, but the quote request returned no NSE prices.");
      } else if (missing.length > 0) {
        setError(`Kite did not return a quote for ${missing.join(", ")}.`);
      } else {
        setError(null);
      }
      let history: Record<string, PriceBar[]> = {};
      try {
        if (quoteResult.quotes.length > 0) {
          const fetched = await fetchKiteHistory([...SYMBOLS, "NIFTY"]);
          setNiftyBars(fetched.NIFTY ?? []);
          delete fetched.NIFTY;
          history = fetched;
        }
      } catch (caught) {
        if (caught instanceof KiteAuthError) throw caught;
        setError("Live prices loaded. Kite did not return daily candles, so the chart cannot be drawn from the exchange.");
      }
      try {
        const holdingHistory = await fetchKiteHistoryPairs(holdingRows);
        const merged = { ...history };
        for (const [symbol, bars] of Object.entries(holdingHistory)) {
          if (!merged[symbol] || bars.length > merged[symbol].length) merged[symbol] = bars;
        }
        setHistories(merged);
      } catch (caught) {
        if (caught instanceof KiteAuthError) throw caught;
        setHistories(history);
        setHoldingsError("Holdings loaded. Kite did not return daily candles, so the exit signal is waiting on EMA 20.");
      }
    } catch (caught) {
      setQuotes({});
      setHistories({});
      setNiftyBars([]);
      setHoldings([]);
      setMissingSymbols([]);
      if (caught instanceof KiteAuthError) {
        setNeedsReconnect(true);
        setStatus((current) =>
          current ? { ...current, connected: false, expired: true, userName: null, userId: null, expiresAt: null } : current,
        );
        setError(RECONNECT_MESSAGE);
      } else {
        setError(caught instanceof Error ? caught.message : "Could not reach Kite.");
      }
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [rememberRefresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (statusRef.current?.connected) void refresh();
  }, [extraQuoteSymbols, refresh]);

  useEffect(() => {
    let morningTimer = 0;
    const armMorning = () => {
      const delay = Math.max(1_000, nextMorningRefresh() - Date.now());
      morningTimer = window.setTimeout(() => {
        void refresh();
        armMorning();
      }, delay);
    };
    armMorning();

    const catchUp = () => {
      if (document.visibilityState === "hidden") return;
      if (morningRefreshDue(lastRefreshRef.current)) void refresh();
    };
    document.addEventListener("visibilitychange", catchUp);
    const poll = window.setInterval(catchUp, 15 * 60 * 1000);
    return () => {
      window.clearTimeout(morningTimer);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", catchUp);
    };
  }, [refresh]);

  useEffect(() => {
    if (!autoRefreshMs) return;
    const tick = () => {
      if (document.visibilityState === "hidden") return;
      if (marketStatus().phase !== "open") return;
      if (!statusRef.current?.connected || needsReconnect) return;
      void refreshQuotes();
    };
    const timer = window.setInterval(tick, autoRefreshMs);
    return () => window.clearInterval(timer);
  }, [autoRefreshMs, refreshQuotes, needsReconnect]);

  const logout = useCallback(async () => {
    await logoutKite();
    setQuotes({});
    setHistories({});
    setNiftyBars([]);
    setHoldings([]);
    setHoldingsError(null);
    setError(null);
    setNeedsReconnect(false);
    const nextStatus = await fetchKiteStatus();
    setStatus(nextStatus);
    statusRef.current = nextStatus;
  }, []);

  const saveCredentials = useCallback(
    async (apiKey: string, apiSecret: string) => {
      await saveKiteCredentials(apiKey, apiSecret);
      const nextStatus = await fetchKiteStatus();
      setStatus(nextStatus);
      statusRef.current = nextStatus;
      setError(null);
    },
    [],
  );

  const login = useCallback(() => {
    void (async () => {
      const current = statusRef.current ?? (await fetchKiteStatus());
      statusRef.current = current;
      setStatus(current);
      if (!current.configured) {
        setError("Save the API key and secret below first. The .env file itself cannot be edited from this view.");
        return;
      }
      window.location.assign("/api/kite/login");
    })();
  }, []);

  const value = useMemo<MarketDataValue>(() => {
    return {
      status: status ?? EMPTY_STATUS,
      mode: Object.keys(quotes).length > 0 ? "live" : "sample",
      quotes,
      histories,
      niftyBars,
      holdings,
      holdingsError,
      loading,
      error,
      missingSymbols,
      needsReconnect,
      lastRefreshAt,
      autoRefreshMs,
      setAutoRefreshMs,
      quotesPolling,
      refresh,
      refreshQuotes,
      login,
      logout,
      saveCredentials,
    };
  }, [
    status,
    quotes,
    histories,
    niftyBars,
    holdings,
    holdingsError,
    loading,
    error,
    missingSymbols,
    needsReconnect,
    lastRefreshAt,
    autoRefreshMs,
    setAutoRefreshMs,
    quotesPolling,
    refresh,
    refreshQuotes,
    login,
    logout,
    saveCredentials,
  ]);

  return <MarketDataContext.Provider value={value}>{children}</MarketDataContext.Provider>;
}

export function useMarketData(): MarketDataValue {
  const value = useContext(MarketDataContext);
  if (!value) throw new Error("useMarketData must be used inside MarketDataProvider");
  return value;
}

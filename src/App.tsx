import { useCallback, useEffect, useMemo, useState } from "react";
import { useScanResults } from "./scanner/useScanResults";
import { loadAddedHoldings, saveAddedHoldings, type HoldingInput } from "./portfolio";
import { AlertsProvider } from "./alerts/AlertsContext";
import { AlertToast, Alerts } from "./components/Alerts";
import { Backtest } from "./components/Backtest";
import { Journal } from "./components/Journal";
import { KiteSettings } from "./components/KiteSettings";
import { Sectors } from "./components/Sectors";
import { MarketDataProvider } from "./market/MarketData";
import { Analysis } from "./components/Analysis";
import { Overview } from "./components/Overview";
import { PlaceholderView } from "./components/PlaceholderView";
import { Portfolio } from "./components/Portfolio";
import { Recommendations } from "./components/Recommendations";
import { StockDetail } from "./components/StockDetail";
import { Watchlist } from "./components/Watchlist";
import { NAV_ITEMS, Sidebar, type DeskView } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { loadWatchlist, saveWatchlist } from "./watchlist/storage";

interface RouteState {
  view: DeskView;
  symbol: string | null;
}

function parseHash(hash: string): RouteState {
  const parts = hash.replace(/^#/, "").split("/").filter(Boolean);
  const head = parts[0] ?? "overview";
  const item = NAV_ITEMS.find((entry) => entry.id === head);
  const view = item?.id ?? "overview";
  const rawSymbol = view === "recommendations" ? parts[1] : undefined;
  const symbol = rawSymbol ? rawSymbol.toUpperCase().replace(/[^A-Z0-9&-]/g, "") : null;
  return { view, symbol: symbol || null };
}

export default function App() {
  const [route, setRoute] = useState<RouteState>(() => parseHash(window.location.hash));
  const [addedHoldings, setAddedHoldings] = useState<HoldingInput[]>(() => loadAddedHoldings());
  const [watchlist, setWatchlist] = useState<string[]>(() => loadWatchlist());

  const persistAdded = useCallback((next: HoldingInput[] | ((current: HoldingInput[]) => HoldingInput[])) => {
    setAddedHoldings((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      saveAddedHoldings(resolved);
      return resolved;
    });
  }, []);

  const extraQuoteSymbols = useMemo(
    () => [...new Set([...watchlist, ...addedHoldings.map((holding) => holding.symbol)])],
    [addedHoldings, watchlist],
  );

  const addWatchSymbol = useCallback((symbol: string) => {
    setWatchlist((current) => {
      const next = current.includes(symbol) ? current : [...current, symbol];
      saveWatchlist(next);
      return next;
    });
  }, []);

  const removeWatchSymbol = useCallback((symbol: string) => {
    setWatchlist((current) => {
      const next = current.filter((item) => item !== symbol);
      saveWatchlist(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!window.location.hash) {
      window.history.replaceState(null, "", "#/overview");
    }
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const openSymbol = useCallback((symbol: string) => {
    window.location.hash = `#/recommendations/${symbol}`;
  }, []);

  const closeSymbol = useCallback(() => {
    window.location.hash = "#/recommendations";
  }, []);

  const activeNav = NAV_ITEMS.find((item) => item.id === route.view) ?? NAV_ITEMS[0];

  return (
    <MarketDataProvider extraQuoteSymbols={extraQuoteSymbols}>
    <AlertsProvider added={addedHoldings}>
    <DeskBody
      route={route}
      addedHoldings={addedHoldings}
      activeNav={activeNav}
      openSymbol={openSymbol}
      closeSymbol={closeSymbol}
      watchlist={watchlist}
      addWatchSymbol={addWatchSymbol}
      removeWatchSymbol={removeWatchSymbol}
      setAddedHoldings={persistAdded}
    />
    </AlertsProvider>
    </MarketDataProvider>
  );
}

function DeskBody({
  route,
  addedHoldings,
  activeNav,
  openSymbol,
  closeSymbol,
  watchlist,
  addWatchSymbol,
  removeWatchSymbol,
  setAddedHoldings,
}: {
  route: RouteState;
  addedHoldings: HoldingInput[];
  activeNav: (typeof NAV_ITEMS)[number];
  openSymbol: (symbol: string) => void;
  closeSymbol: () => void;
  watchlist: string[];
  addWatchSymbol: (symbol: string) => void;
  removeWatchSymbol: (symbol: string) => void;
  setAddedHoldings: (next: HoldingInput[] | ((current: HoldingInput[]) => HoldingInput[])) => void;
}) {
  const scanned = useScanResults();
  const selected = route.symbol ? (scanned.find((security) => security.symbol === route.symbol) ?? null) : null;

  return (
    <div className="shell">
      <Sidebar active={route.view} />
      <div className="workspace">
        <TopBar />
        <main className="content">
          {route.view === "overview" ? (
            <Overview added={addedHoldings} />
          ) : route.view === "recommendations" && route.symbol ? (
            <StockDetail security={selected} symbol={route.symbol} onBack={closeSymbol} />
          ) : route.view === "recommendations" ? (
            <Recommendations
              selectedSymbol={null}
              onOpen={openSymbol}
              added={addedHoldings}
              watchlist={watchlist}
              onToggleWatch={(symbol) => (watchlist.includes(symbol) ? removeWatchSymbol(symbol) : addWatchSymbol(symbol))}
            />
          ) : route.view === "analysis" ? (
            <Analysis />
          ) : route.view === "portfolio" ? (
            <Portfolio
              added={addedHoldings}
              onAdd={(holding) =>
                setAddedHoldings((current) => [
                  ...current.filter((item) => item.symbol !== holding.symbol),
                  holding,
                ])
              }
              onOpenSymbol={openSymbol}
            />
          ) : route.view === "watchlist" ? (
            <Watchlist symbols={watchlist} onAdd={addWatchSymbol} onRemove={removeWatchSymbol} />
          ) : route.view === "backtest" ? (
            <Backtest />
          ) : route.view === "alerts" ? (
            <Alerts />
          ) : route.view === "settings" ? (
            <KiteSettings />
          ) : route.view === "sectors" ? (
            <Sectors />
          ) : route.view === "journal" ? (
            <Journal />
          ) : (
            <PlaceholderView title={activeNav.label} message={activeNav.placeholder ?? ""} />
          )}
        </main>
      </div>
      <AlertToast />
    </div>
  );
}

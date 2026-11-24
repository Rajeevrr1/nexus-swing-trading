import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMarketData } from "../market/MarketData";
import { liveBookPositions } from "../portfolio/liveBook";
import type { HoldingInput } from "../portfolio";
import { resolveScanResults } from "../scanner";
import { buildAnalysis } from "../analysis";
import { evaluateSwingSetup, sectorStrength } from "../recommendations/setup";
import { buildOpenRiskBook } from "../risk/openBook";
import { useRiskSettings } from "../risk/settings";
import { loadTradeBook } from "../portfolio/tradeBook";
import { getUniverse } from "../scanner/universe";
import { evaluateAlerts } from "./evaluate";
import { notifyTelegramAlerts } from "./telegramClient";
import { loadAlertMemory, saveAlertMemory } from "./storage";
import type { AlertMemory, DeskAlert } from "./types";

interface AlertsValue {
  alerts: DeskAlert[];
  unread: number;
  toast: DeskAlert | null;
  dismissToast: () => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
}

const AlertsContext = createContext<AlertsValue | null>(null);

export function AlertsProvider({ added, children }: { added: readonly HoldingInput[]; children: ReactNode }) {
  const market = useMarketData();
  const riskSettings = useRiskSettings();
  const [memory, setMemory] = useState<AlertMemory>(() => loadAlertMemory());
  const [toast, setToast] = useState<DeskAlert | null>(null);

  useEffect(() => {
    const connected = market.status.connected && !market.needsReconnect;
    const scan = resolveScanResults(market.histories, market.niftyBars, connected);
    const openBook = buildOpenRiskBook({
      connected,
      holdings: market.holdings,
      added,
      stops: new Map(loadTradeBook().map((row) => [row.symbol, row.initialStop])),
      sectorBySymbol: new Map(getUniverse().map((security) => [security.symbol, security.sector])),
    });
    const positions = liveBookPositions({
      connected,
      holdings: market.holdings,
      added,
      histories: market.histories,
      quotes: market.quotes,
      niftyBars: market.niftyBars,
      scan,
      holdingsLoaded: connected && !market.loading && !market.holdingsError,
    });
    const setups = Object.fromEntries(
      scan.flatMap((security) => {
        const live = market.histories[security.symbol] ?? [];
        const bars = live.length >= 50 ? live : connected ? [] : buildAnalysis(security).bars;
        if (bars.length < 50) return [];
        return [
          [
            security.symbol,
            // Prime requires sector strength ≥ 55. A null score used to fail that gate and drop the prime alert.
            evaluateSwingSetup(bars, market.niftyBars, sectorStrength(security), riskSettings, {
              openRiskRupees: openBook.openRiskRupees,
              openSectors: openBook.openSectors,
              sector: security.sector,
              livePrice: market.quotes[security.symbol]?.lastPrice ?? null,
            }),
          ] as const,
        ];
      }),
    );
    const evaluation = evaluateAlerts(memory, { connected, positions, scan, setups });
    const changed = JSON.stringify(evaluation.memory) !== JSON.stringify(memory);
    if (!changed) return;
    setMemory(evaluation.memory);
    saveAlertMemory(evaluation.memory);
    if (evaluation.fresh.length > 0) {
      setToast(evaluation.fresh[0]);
      void notifyTelegramAlerts(evaluation.fresh, market.quotes);
    }
  }, [added, market.histories, market.holdings, market.holdingsError, market.loading, market.needsReconnect, market.niftyBars, market.quotes, market.status.connected, memory, riskSettings]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 8000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const value = useMemo<AlertsValue>(() => {
    const update = (next: AlertMemory) => {
      setMemory(next);
      saveAlertMemory(next);
    };
    return {
      alerts: memory.alerts,
      // Cleared rows stay in history. The badge counts only alerts that are still active and unread.
      unread: memory.alerts.filter((alert) => alert.active && !alert.read).length,
      toast,
      dismissToast: () => setToast(null),
      markRead: (id: string) =>
        update({ ...memory, alerts: memory.alerts.map((alert) => (alert.id === id ? { ...alert, read: true } : alert)) }),
      markAllRead: () => update({ ...memory, alerts: memory.alerts.map((alert) => ({ ...alert, read: true })) }),
    };
  }, [memory, toast]);

  return <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>;
}

export function useAlerts(): AlertsValue {
  const value = useContext(AlertsContext);
  if (!value) throw new Error("useAlerts must be used inside AlertsProvider");
  return value;
}

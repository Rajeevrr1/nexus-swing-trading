import { useMemo } from "react";
import { useMarketData } from "../market/MarketData";
import { resolveScanResults } from "./resolveScan";
import { isRecommendation } from "./score";
import type { Recommendation, ScoredSecurity } from "./types";

export function useScanResults(): ScoredSecurity[] {
  const market = useMarketData();
  const connected = market.status.connected && !market.needsReconnect;
  return useMemo(
    () => resolveScanResults(market.histories, market.niftyBars, connected),
    [connected, market.histories, market.niftyBars],
  );
}

export function useRecommendations(): Recommendation[] {
  const scanned = useScanResults();
  return useMemo(() => scanned.filter(isRecommendation), [scanned]);
}

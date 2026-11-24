import { useMemo } from "react";
import { useMarketData } from "../market/MarketData";
import { loadAddedHoldings } from "../portfolio/addedHoldings";
import { loadTradeBook } from "../portfolio/tradeBook";
import { getUniverse } from "../scanner/universe";
import { positionRiskRupees } from "./positionSizing";

export interface OpenRiskBook {
  /** Sum of rupee risk on positions already open. */
  openRiskRupees: number;
  /** Sectors that already have at least one open name. */
  openSectors: ReadonlySet<string>;
}

interface HeldName {
  symbol: string;
  entry: number;
  quantity: number;
}

/**
 * Open kite names, plus added names that are not already in the kite book.
 * Risk uses the frozen trade-book stop, or the 2.5% floor when no stop is stored.
 */
export function buildOpenRiskBook(input: {
  connected: boolean;
  holdings: readonly { symbol: string; averagePrice: number; quantity: number }[];
  added: readonly { symbol: string; entry: number; quantity: number }[];
  stops: ReadonlyMap<string, number>;
  sectorBySymbol: ReadonlyMap<string, string>;
}): OpenRiskBook {
  const kiteSymbols = new Set(input.connected ? input.holdings.map((row) => row.symbol) : []);
  const names: HeldName[] = [];
  if (input.connected) {
    for (const holding of input.holdings) {
      names.push({ symbol: holding.symbol, entry: holding.averagePrice, quantity: holding.quantity });
    }
  }
  for (const holding of input.added) {
    if (kiteSymbols.has(holding.symbol)) continue;
    names.push({ symbol: holding.symbol, entry: holding.entry, quantity: holding.quantity });
  }

  let openRiskRupees = 0;
  const openSectors = new Set<string>();
  for (const name of names) {
    openRiskRupees += positionRiskRupees({
      entry: name.entry,
      quantity: name.quantity,
      stop: input.stops.get(name.symbol) ?? null,
    });
    const sector = input.sectorBySymbol.get(name.symbol);
    if (sector) openSectors.add(sector);
  }
  return { openRiskRupees, openSectors };
}

/** Live book used to size the next trigger. Recomputes when holdings change. */
export function useOpenRiskBook(): OpenRiskBook {
  const market = useMarketData();
  const connected = market.status.connected && !market.needsReconnect;
  const added = loadAddedHoldings();
  const holdingKey = market.holdings.map((row) => `${row.symbol}:${row.averagePrice}:${row.quantity}`).join("|");
  const addedKey = added.map((row) => `${row.symbol}:${row.entry}:${row.quantity}`).join("|");
  return useMemo(() => {
    const stops = new Map(loadTradeBook().map((row) => [row.symbol, row.initialStop]));
    const sectorBySymbol = new Map(getUniverse().map((security) => [security.symbol, security.sector]));
    return buildOpenRiskBook({
      connected,
      holdings: market.holdings,
      added,
      stops,
      sectorBySymbol,
    });
  }, [addedKey, connected, holdingKey]);
}

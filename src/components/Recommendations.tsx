import { useMemo, useState } from "react";
import { buildAnalysis, formatInr } from "../analysis";
import { useMarketData } from "../market/MarketData";
import { evaluateMarketRegime } from "../market/status";
import type { HoldingInput } from "../portfolio";
import { deskPicks, evaluateSwingSetup, prioritize, sectorStrength, triggerBadge, triggerBadgeClass, type SwingSetup } from "../recommendations/setup";
import { useOpenRiskBook } from "../risk/openBook";
import { useRiskSettings } from "../risk/settings";
import { MAX_PER_SECTOR, maxSlotsForRegime } from "../strategy/policy";
import { SCAN_AS_OF, type Recommendation } from "../scanner";
import { useScanResults } from "../scanner/useScanResults";
import { RecommendationCard } from "./RecommendationCard";

type FilterTab = "all" | "active" | "gtt" | "near";

export function Recommendations({
  selectedSymbol,
  onOpen,
  added = [],
  watchlist = [],
  onToggleWatch,
}: {
  selectedSymbol: string | null;
  onOpen: (symbol: string) => void;
  added?: readonly HoldingInput[];
  watchlist?: readonly string[];
  onToggleWatch?: (symbol: string) => void;
}) {
  const market = useMarketData();
  const scanned = useScanResults();
  const connected = market.status.connected && !market.needsReconnect;

  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [sectorFilter, setSectorFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sheetOpen, setSheetOpen] = useState<boolean>(true);

  const riskSettings = useRiskSettings();
  const openBook = useOpenRiskBook();
  const regime = useMemo(() => evaluateMarketRegime(market.niftyBars), [market.niftyBars]);
  const maxSlots = maxSlotsForRegime(regime.tier);

  const setups: Record<string, SwingSetup> = useMemo(() => {
    const next: Record<string, SwingSetup> = {};
    for (const security of scanned) {
      const bars = market.histories[security.symbol]?.length
        ? market.histories[security.symbol]
        : connected
          ? []
          : buildAnalysis(security).bars;
      next[security.symbol] = evaluateSwingSetup(
        bars,
        market.niftyBars,
        sectorStrength(security),
        riskSettings,
        {
          openRiskRupees: openBook.openRiskRupees,
          openSectors: openBook.openSectors,
          sector: security.sector,
          livePrice: market.quotes[security.symbol]?.lastPrice ?? null,
        },
      );
    }
    return next;
  }, [connected, market.histories, market.niftyBars, market.quotes, openBook, riskSettings, scanned]);

  const ranked = prioritize(scanned, setups);
  const picks = deskPicks(ranked, setups);
  const recommendations = ranked.filter((security): security is Recommendation => security.grade != null);
  const belowCut = ranked.filter((security) => security.grade === null);

  const primeCount = recommendations.filter((security) => setups[security.symbol]?.triggerTier === "prime").length;
  const standardCount = recommendations.filter((security) => setups[security.symbol]?.triggerTier === "standard").length;
  const activeCount = primeCount + standardCount;
  const gttCount = recommendations.filter((security) => setups[security.symbol]?.actionBucket === "gtt").length;
  const nearCount = recommendations.filter((security) => setups[security.symbol]?.actionBucket === "near").length;

  const { heldSymbols, sectorCounts, openSlots } = useMemo(() => {
    const sectorBySymbol = new Map(scanned.map((s) => [s.symbol, s.sector]));
    const held = new Set<string>();
    if (connected) {
      for (const h of market.holdings) held.add(h.symbol);
    }
    for (const h of added) held.add(h.symbol);
    const secCounts = new Map<string, number>();
    for (const sym of held) {
      const sec = sectorBySymbol.get(sym);
      if (sec) secCounts.set(sec, (secCounts.get(sec) ?? 0) + 1);
    }
    return {
      heldSymbols: held,
      sectorCounts: secCounts,
      openSlots: Math.max(0, maxSlots - held.size),
    };
  }, [added, connected, market.holdings, maxSlots, scanned]);

  const watchSet = useMemo(() => new Set(watchlist), [watchlist]);

  const sectors = useMemo(
    () => [...new Set(recommendations.map((r) => r.sector))].sort(),
    [recommendations],
  );

  const executionRows = useMemo(
    () =>
      ranked.filter((sec) => {
        const setup = setups[sec.symbol];
        return setup?.triggerTier != null || setup?.actionBucket === "gtt";
      }),
    [ranked, setups],
  );

  const filteredRecommendations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return recommendations.filter((sec) => {
      const setup = setups[sec.symbol];
      if (filterTab === "active" && !setup?.triggerTier) return false;
      if (filterTab === "gtt" && setup?.actionBucket !== "gtt") return false;
      if (filterTab === "near" && setup?.actionBucket !== "near") return false;
      if (sectorFilter !== "ALL" && sec.sector !== sectorFilter) return false;
      if (q && !sec.symbol.toLowerCase().includes(q) && !sec.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [filterTab, recommendations, searchQuery, sectorFilter, setups]);

  const isLive = connected && market.mode === "live";

  return (
    <section className="recs" data-page="recommendations" aria-labelledby="recs-heading">
      <header className="recs-hero">
        <div className="recs-hero-copy">
          <p className="ov-brand">Recommendations</p>
          <h1 id="recs-heading">Trade setups</h1>
          <p className="recs-lead">
            {isLive
              ? `${openSlots}/${maxSlots} slots open · v1.4 Prime-only triggers (spread ≤ 2.5%, sector ≥ 55) with entry, stop, T1 +6% / T2 EMA 20 trail, and size.`
              : `Sample rankings until Kite is connected. ${SCAN_AS_OF}.`}
          </p>
          {market.error ? <p className="feed-note">{market.error}</p> : null}
        </div>
      </header>

      <div className="recs-counts" aria-label="Setup counts">
        <div className="recs-count is-prime">
          <span>Prime</span>
          <strong className="num">{primeCount}</strong>
        </div>
        <div className="recs-count is-standard">
          <span>Std (Paused)</span>
          <strong className="num">{standardCount}</strong>
        </div>
        <div className="recs-count is-gtt">
          <span>GTT</span>
          <strong className="num">{gttCount}</strong>
        </div>
        <div className="recs-count is-near">
          <span>Near</span>
          <strong className="num">{nearCount}</strong>
        </div>
        <div className="recs-count is-graded">
          <span>Graded</span>
          <strong className="num">{recommendations.length}</strong>
        </div>
        <div className="recs-count is-slots">
          <span>Slots</span>
          <strong className="num">
            {openSlots}
            <span className="recs-count-of">/{maxSlots}</span>
          </strong>
        </div>
      </div>

      {executionRows.length > 0 ? (
        <div className="recs-sheet">
          <div className="recs-sheet-head">
            <div>
              <h2>Execution sheet</h2>
              <p>{executionRows.length} ready triggers &amp; GTT levels</p>
            </div>
            <button type="button" className="ov-btn ov-btn-ghost" onClick={() => setSheetOpen((open) => !open)}>
              {sheetOpen ? "Hide" : "Show"}
            </button>
          </div>
          {sheetOpen ? (
            <div className="gtt-table-wrap">
              <table className="gtt-table">
                <thead>
                  <tr>
                    <th>Stock</th>
                    <th>Setup</th>
                    <th className="num">Buy / GTT</th>
                    <th className="num">Max chase</th>
                    <th className="num">Stop</th>
                    <th className="num">T1 (+6%)</th>
                    <th className="num">Qty</th>
                    <th>Guard</th>
                  </tr>
                </thead>
                <tbody>
                  {executionRows.slice(0, 12).map((sec) => {
                    const setup = setups[sec.symbol];
                    const isTrigger = setup.triggerTier != null;
                    const limitPrice = isTrigger ? setup.entryPrice : setup.buyZoneTop;
                    const inPort = heldSymbols.has(sec.symbol);
                    const secCount = sectorCounts.get(sec.sector) ?? 0;
                    return (
                      <tr key={sec.symbol} onClick={() => onOpen(sec.symbol)}>
                        <td className="gtt-stock">
                          <span className="ticker-inline">{sec.symbol}</span>
                          <span className="gtt-sector">{sec.sector}</span>
                        </td>
                        <td>
                          <span className={triggerBadgeClass(setup.triggerTier, setup.actionBucket)}>
                            {triggerBadge(setup.triggerTier, setup.actionBucket)}
                          </span>
                        </td>
                        <td className="num gtt-cell-buy">
                          <strong>
                            {limitPrice == null ? <span className="cell-dash">—</span> : formatInr(limitPrice)}
                          </strong>
                          <span className="gtt-price-hint">{isTrigger ? "Trigger" : "GTT"}</span>
                        </td>
                        <td className="num">
                          {setup.maxChasePrice == null ? (
                            <span className="cell-dash">—</span>
                          ) : (
                            formatInr(setup.maxChasePrice)
                          )}
                        </td>
                        <td className="num gtt-cell-stop">
                          {setup.initialStopLoss == null ? (
                            <span className="cell-dash">—</span>
                          ) : (
                            formatInr(setup.initialStopLoss)
                          )}
                        </td>
                        <td className="num gtt-cell-target">
                          {setup.t1TargetPrice == null ? (
                            <span className="cell-dash">—</span>
                          ) : (
                            formatInr(setup.t1TargetPrice)
                          )}
                        </td>
                        <td className="num">
                          {setup.suggestedQty != null ? (
                            `${setup.suggestedQty}`
                          ) : (
                            <span className="cell-dash">—</span>
                          )}
                        </td>
                        <td>
                          {inPort ? (
                            <span className="book-guard-pill is-held">Held</span>
                          ) : openSlots <= 0 ? (
                            <span className="book-guard-pill is-capped">{maxSlots === 0 ? "Blocked" : "Full"}</span>
                          ) : secCount >= MAX_PER_SECTOR ? (
                            <span className="book-guard-pill is-capped">Sector</span>
                          ) : (
                            <span className="book-guard-pill is-open">Open</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="recs-toolbar" role="region" aria-label="Filter recommendations">
        <div className="recs-tabs" role="tablist">
          {(
            [
              ["all", `All (${recommendations.length})`],
              ["active", `Active (${activeCount})`],
              ["gtt", `GTT (${gttCount})`],
              ["near", `Near (${nearCount})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filterTab === id}
              className={`recs-tab-btn${filterTab === id ? " is-active" : ""}`}
              onClick={() => setFilterTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="recs-controls">
          <select
            aria-label="Filter by sector"
            className="recs-select"
            value={sectorFilter}
            onChange={(event) => setSectorFilter(event.target.value)}
          >
            <option value="ALL">All sectors</option>
            {sectors.map((sector) => (
              <option key={sector} value={sector}>
                {sector}
              </option>
            ))}
          </select>
          <input
            type="search"
            aria-label="Search symbol or company"
            className="recs-search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search…"
          />
        </div>
      </div>

      {filteredRecommendations.length === 0 ? (
        <div className="ov-empty">
          <p>
            {recommendations.length === 0
              ? "No graded names yet. Connect Kite or wait for the next refresh."
              : "No setups match these filters."}
          </p>
          {filterTab !== "all" || sectorFilter !== "ALL" || searchQuery ? (
            <button
              type="button"
              className="ov-btn ov-btn-primary"
              style={{ marginTop: 12 }}
              onClick={() => {
                setFilterTab("all");
                setSectorFilter("ALL");
                setSearchQuery("");
              }}
            >
              Clear filters
            </button>
          ) : null}
        </div>
      ) : (
        <div className="rcards">
          {filteredRecommendations.map((recommendation) => (
            <RecommendationCard
              key={recommendation.symbol}
              recommendation={recommendation}
              setup={setups[recommendation.symbol]}
              deskPick={picks.has(recommendation.symbol)}
              selected={selectedSymbol === recommendation.symbol}
              inPortfolio={heldSymbols.has(recommendation.symbol)}
              sectorCount={sectorCounts.get(recommendation.sector) ?? 0}
              openSlots={openSlots}
              maxSlots={maxSlots}
              isWatched={watchSet.has(recommendation.symbol)}
              onToggleWatch={onToggleWatch}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}

      {belowCut.length > 0 ? (
        <p className="below-cut">
          <span className="below-label">Below cut</span>
          {belowCut.slice(0, 24).map((security) => (
            <span key={security.symbol} className="below-name">
              <span className="ticker-inline">{security.symbol}</span>
              <span className="tone-text-weak">{security.conviction}</span>
            </span>
          ))}
        </p>
      ) : null}
    </section>
  );
}

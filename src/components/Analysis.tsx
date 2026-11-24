import { useMemo } from "react";
import { buildAnalysis, formatInr } from "../analysis";
import { useMarketData } from "../market/MarketData";
import { evaluateMarketRegime } from "../market/status";
import { evaluateSwingSetup, prioritize, sectorStrength, triggerBadge, triggerBadgeClass } from "../recommendations/setup";
import { useOpenRiskBook } from "../risk/openBook";
import { useRiskSettings } from "../risk/settings";
import { buildSectorRows, trailingReturn } from "../sectors/rotation";
import { FACTOR_LABELS, type FactorKey } from "../scanner";
import { useRecommendations, useScanResults } from "../scanner/useScanResults";
import { maxSlotsForRegime } from "../strategy/policy";
import { STRATEGY_NOTE } from "../strategy";
import { StandardPerformanceCard } from "./StandardPerformanceCard";

const FACTOR_KEYS: FactorKey[] = ["trueRs", "volume", "sector", "closingStrength"];

export function Analysis() {
  const market = useMarketData();
  const scanned = useScanResults();
  const recommendations = useRecommendations();
  const connected = market.status.connected && !market.needsReconnect;
  const isLive = connected && market.mode === "live";
  const riskSettings = useRiskSettings();
  const openBook = useOpenRiskBook();
  const regime = useMemo(() => evaluateMarketRegime(market.niftyBars), [market.niftyBars]);
  const maxSlots = maxSlotsForRegime(regime.tier);

  const setups = useMemo(
    () =>
      Object.fromEntries(
        recommendations.map((security) => [
          security.symbol,
          evaluateSwingSetup(
            market.histories[security.symbol]?.length
              ? market.histories[security.symbol]
              : connected
                ? []
                : buildAnalysis(security).bars,
            market.niftyBars,
            sectorStrength(security),
            riskSettings,
            {
              openRiskRupees: openBook.openRiskRupees,
              openSectors: openBook.openSectors,
              sector: security.sector,
              livePrice: market.quotes[security.symbol]?.lastPrice ?? null,
            },
          ),
        ]),
      ),
    [connected, market.histories, market.niftyBars, market.quotes, openBook, recommendations, riskSettings],
  );

  const ranked = prioritize(recommendations, setups);
  const prime = ranked.filter((s) => setups[s.symbol]?.triggerTier === "prime");
  const standard = ranked.filter((s) => setups[s.symbol]?.triggerTier === "standard");
  const watches = ranked.filter((s) => !setups[s.symbol]?.triggerTier).slice(0, 8);

  const returns = useMemo(() => {
    const map: Record<string, number | null> = {};
    for (const security of scanned) {
      const bars = market.histories[security.symbol];
      if (bars && bars.length > 20) {
        map[security.symbol] = trailingReturn(bars.map((b) => b.close));
      } else {
        map[security.symbol] = null;
      }
    }
    return map;
  }, [market.histories, scanned]);

  const sectors = useMemo(() => buildSectorRows(scanned, returns).slice(0, 8), [returns, scanned]);

  const avgFactors = useMemo(() => {
    if (recommendations.length === 0) return null;
    const sums: Record<FactorKey, number> = {
      trueRs: 0,
      volume: 0,
      sector: 0,
      closingStrength: 0,
    };
    for (const security of recommendations) {
      for (const factor of security.factors) sums[factor.key] += factor.value;
    }
    const n = recommendations.length;
    return FACTOR_KEYS.map((key) => ({
      key,
      label: FACTOR_LABELS[key],
      value: Math.round(sums[key] / n),
    }));
  }, [recommendations]);

  return (
    <section className="panel kite-panel analysis-page" data-page="analysis" aria-labelledby="analysis-heading">
      <div className={`feed-mode-banner ${isLive ? "is-live" : "is-sample"}`} role="status">
        <strong className="feed-mode-badge">{isLive ? "LIVE" : "SAMPLE"}</strong>
        <span>
          {isLive
            ? "Factor and regime analysis from Kite candles."
            : "Sample analysis until Kite is connected."}
        </span>
        <span className={`regime-chip regime-${regime.tier}`}>{regime.label}</span>
      </div>

      <div className="panel-head analysis-head">
        <div className="analysis-hero">
          <p className="ov-brand">Market & setup analysis</p>
          <h1 id="analysis-heading">Analysis</h1>
          <p className="strategy-note">{STRATEGY_NOTE}</p>
          <p className="lede">
            Regime, factor blend, sector rotation, and trigger breakdown. Use Recommendations to act on setups.
          </p>
        </div>
        <p className="count analysis-count">
          <strong className="num">{prime.length + standard.length}</strong>
          <span>
            active triggers
            <br />
            {maxSlots} slot{maxSlots === 1 ? "" : "s"} allowed
          </span>
        </p>
      </div>

      <StandardPerformanceCard />

      <div className="analysis-grid">
        <article className="analysis-card">
          <h2>Regime</h2>
          <p className={`analysis-regime regime-${regime.tier}`}>{regime.label}</p>
          <p className="kite-quiet">{regime.summary}</p>
          {regime.extensionWarning ? <p className="regime-extension">{regime.extensionWarning}</p> : null}
          <dl className="analysis-dl">
            <div>
              <dt>Prime / Standard</dt>
              <dd className="num">
                {regime.primeRiskScale.toFixed(1)}x / {regime.standardRiskScale.toFixed(1)}x
              </dd>
            </div>
            <div>
              <dt>Max slots</dt>
              <dd className="num">{regime.maxSlots}</dd>
            </div>
            <div>
              <dt>Nifty close</dt>
              <dd className="num">{regime.niftyClose == null ? "—" : formatInr(regime.niftyClose)}</dd>
            </div>
            <div>
              <dt>EMA 20 / 50</dt>
              <dd className="num">
                {regime.ema20 == null || regime.ema50 == null
                  ? "—"
                  : `${formatInr(regime.ema20)} / ${formatInr(regime.ema50)}`}
              </dd>
            </div>
          </dl>
        </article>

        <article className="analysis-card">
          <h2>Trigger mix</h2>
          <ul className="analysis-mix">
            <li>
              <span>Prime</span>
              <strong className="num">{prime.length}</strong>
            </li>
            <li>
              <span>Standard (0.5x)</span>
              <strong className="num">{standard.length}</strong>
            </li>
            <li>
              <span>Graded watches</span>
              <strong className="num">{recommendations.length - prime.length - standard.length}</strong>
            </li>
            <li>
              <span>Universe scanned</span>
              <strong className="num">{scanned.length}</strong>
            </li>
          </ul>
          <a className="kite-connect analysis-link" href="#/recommendations">
            Open recommendations
          </a>
        </article>

        <article className="analysis-card analysis-card-wide">
          <h2>Average factors (graded names)</h2>
          {avgFactors == null ? (
            <p className="empty-note">No graded recommendations yet.</p>
          ) : (
            <ul className="factor-bars">
              {avgFactors.map((factor) => (
                <li key={factor.key}>
                  <div className="factor-bar-head">
                    <span>{factor.label}</span>
                    <span className="num">{factor.value}</span>
                  </div>
                  <div className="factor-bar-track" aria-hidden="true">
                    <span className="factor-bar-fill" style={{ width: `${factor.value}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>

      <div className="overview-split analysis-split">
        <div className="analysis-list-block">
          <div className="section-head">
            <h2>Active & near setups</h2>
            <a href="#/recommendations">All setups</a>
          </div>
          {[...prime, ...standard, ...watches].length === 0 ? (
            <p className="empty-note">No setups to inspect.</p>
          ) : (
            <ul className="overview-setup-list analysis-setup-list">
              {[...prime, ...standard, ...watches].slice(0, 10).map((security) => {
                const setup = setups[security.symbol];
                return (
                  <li key={security.symbol}>
                    <a className="overview-setup-row" href={`#/recommendations/${security.symbol}`}>
                      <span className="ticker-inline">{security.symbol}</span>
                      <span className={triggerBadgeClass(setup?.triggerTier ?? null, setup?.actionBucket ?? null)}>
                        {triggerBadge(setup?.triggerTier ?? null, setup?.actionBucket ?? null)}
                      </span>
                      <span className="overview-setup-meta num">
                        Q {setup?.quality ?? "—"} · {security.grade ?? "—"} · {security.conviction}
                      </span>
                      <span className="overview-setup-meta overview-setup-sector">{security.sector}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="analysis-list-block">
          <div className="section-head">
            <h2>Sector strength</h2>
            <a href="#/sectors">Sectors</a>
          </div>
          {sectors.length === 0 ? (
            <p className="empty-note">No sector rows yet.</p>
          ) : (
            <ul className="overview-session-list analysis-sector-list">
              {sectors.map((row) => (
                <li key={row.sector}>
                  <span className="analysis-sector-name">
                    <span className="analysis-sector-rank">#{row.rank}</span>
                    <span>{row.sector}</span>
                  </span>
                  <strong className="num">{Math.round(row.strength)}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

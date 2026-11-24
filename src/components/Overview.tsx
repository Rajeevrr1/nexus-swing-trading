import { useMemo } from "react";
import { useAlerts } from "../alerts/AlertsContext";
import { buildAnalysis, formatInr } from "../analysis";
import { useMarketData } from "../market/MarketData";
import { evaluateMarketRegime } from "../market/status";
import { formatPercent, formatSignedInr, type HoldingInput } from "../portfolio";
import { portfolioSummary } from "../overview/portfolioSummary";
import {
  evaluateSwingSetup,
  prioritize,
  sectorStrength,
  triggerBadge,
  triggerBadgeClass,
  type SwingSetup,
} from "../recommendations/setup";
import { useOpenRiskBook } from "../risk/openBook";
import { useRiskSettings } from "../risk/settings";
import { maxSlotsForRegime } from "../strategy/policy";
import { useRecommendations } from "../scanner/useScanResults";
import { CompactLevels } from "./CompactLevels";

const NIFTY_SYMBOL = "NIFTY";

/** Decorative CSS/SVG sparkline — visual only, no data binding. */
function Sparkline({ tone }: { tone: "up" | "down" | "flat" }) {
  const line =
    tone === "up"
      ? "M1 14 L4 12 L7 13 L10 8 L13 9 L16 5 L19 6 L22 3"
      : tone === "down"
        ? "M1 3 L4 5 L7 4 L10 9 L13 8 L16 12 L19 11 L22 14"
        : "M1 8 L4 9 L7 7 L10 8 L13 9 L16 8 L19 9 L22 8";
  const fill =
    tone === "up"
      ? "M1 14 L4 12 L7 13 L10 8 L13 9 L16 5 L19 6 L22 3 L22 16 L1 16 Z"
      : tone === "down"
        ? "M1 3 L4 5 L7 4 L10 9 L13 8 L16 12 L19 11 L22 14 L22 16 L1 16 Z"
        : "M1 8 L4 9 L7 7 L10 8 L13 9 L16 8 L19 9 L22 8 L22 16 L1 16 Z";
  return (
    <svg className={`ov-spark is-${tone}`} viewBox="0 0 24 16" aria-hidden="true">
      <path className="ov-spark-fill" d={fill} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Overview({ added }: { added: readonly HoldingInput[] }) {
  const market = useMarketData();
  const { unread } = useAlerts();

  const connected = market.status.connected && !market.needsReconnect;
  const isLive = connected && market.mode === "live";
  const nifty = connected ? (market.quotes[NIFTY_SYMBOL] ?? null) : null;
  const summary = portfolioSummary({
    connected,
    holdings: market.holdings,
    added,
    quotes: market.quotes,
  });
  const recommendations = useRecommendations();
  const riskSettings = useRiskSettings();
  const openBook = useOpenRiskBook();
  const regime = useMemo(() => evaluateMarketRegime(market.niftyBars), [market.niftyBars]);
  const maxSlots = maxSlotsForRegime(regime.tier);
  const heldCount =
    (connected ? market.holdings.length : 0) +
    added.filter((row) => !market.holdings.some((h) => h.symbol === row.symbol)).length;
  const openSlots = Math.max(0, maxSlots - heldCount);
  const slotsUsedPct = maxSlots > 0 ? Math.min(100, (heldCount / maxSlots) * 100) : 0;

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
      ) as Record<string, SwingSetup>,
    [connected, market.histories, market.niftyBars, market.quotes, openBook, recommendations, riskSettings],
  );

  const ranked = useMemo(() => prioritize(recommendations, setups), [recommendations, setups]);
  const triggers = useMemo(
    () => ranked.filter((security) => setups[security.symbol]?.triggerTier != null),
    [ranked, setups],
  );
  const gttReady = useMemo(
    () => ranked.filter((security) => setups[security.symbol]?.actionBucket === "gtt").slice(0, 4),
    [ranked, setups],
  );
  const focusList = triggers.length > 0 ? triggers.slice(0, 6) : ranked.slice(0, 5);
  const triggerCount = triggers.length;
  const primaryHref = connected ? "#/recommendations" : "#/settings";
  const primaryLabel = connected ? "All setups" : "Connect Kite";

  const pnlTone = summary.pnl >= 0 ? "up" : "down";
  const niftyChange =
    nifty && nifty.previousClose > 0 ? (nifty.lastPrice - nifty.previousClose) / nifty.previousClose : null;
  const niftyTone = niftyChange == null ? "flat" : niftyChange >= 0 ? "up" : "down";
  const niftyPts =
    nifty && nifty.previousClose > 0 ? nifty.lastPrice - nifty.previousClose : null;

  return (
    <section
      className={`ov${!isLive ? " is-sample" : ""}${!connected ? " is-offline" : ""}`}
      data-page="overview"
      aria-labelledby="overview-heading"
    >
      <header className="ov-bar">
        <div className="ov-bar-copy">
          <p className="ov-brand">NEXUS</p>
          <div className="ov-title-row">
            <h1 id="overview-heading">NSE swing desk</h1>
            {!connected ? <span className="ov-offline-badge">Offline</span> : null}
          </div>
          {connected ? (
            <div className="ov-chips" aria-label="Desk status">
              <span className={`ov-chip ${triggerCount > 0 ? "is-hot" : ""}`}>
                {triggerCount} active trigger{triggerCount === 1 ? "" : "s"}
              </span>
              <span className="ov-chip is-gtt">{gttReady.length} GTT ready</span>
              <span className="ov-chip">{recommendations.length} graded</span>
            </div>
          ) : (
            <p className="ov-lead">Connect Kite for live prices, regime, and executable setups.</p>
          )}
        </div>
        <div className="ov-seg" role="group" aria-label="Quick navigation">
          <a className={`ov-seg-btn is-active${!connected ? " is-connect" : ""}`} href={primaryHref}>
            {primaryLabel}
          </a>
          {connected ? (
            <a className="ov-seg-btn" href="#/portfolio">
              Portfolio
            </a>
          ) : (
            <a className="ov-seg-btn" href="#/recommendations">
              Sample setups
            </a>
          )}
        </div>
      </header>

      <div className="ov-market" aria-label="Desk snapshot">
        <div className={`ov-market-cell${!nifty ? " is-muted" : ""}`}>
          <div className="ov-market-top">
            <span className="ov-market-label">Nifty 50</span>
            <Sparkline tone={niftyTone} />
          </div>
          <span className="ov-market-value num">{nifty ? formatInr(nifty.lastPrice) : "—"}</span>
          <span
            className={`ov-market-delta num is-${niftyTone}${!nifty && !connected ? " is-offline-pill" : ""}`}
          >
            {niftyChange == null
              ? connected
                ? "Waiting"
                : "Offline"
              : `${niftyPts != null && niftyPts >= 0 ? "+" : ""}${niftyPts?.toFixed(1) ?? ""} (${formatPercent(niftyChange)})`}
          </span>
        </div>
        <div className={`ov-market-cell${!summary.live ? " is-muted" : ""}`}>
          <div className="ov-market-top">
            <span className="ov-market-label">Book value</span>
            <Sparkline tone={summary.live ? pnlTone : "flat"} />
          </div>
          <span className="ov-market-value num">{summary.live ? formatInr(summary.currentValue) : "—"}</span>
          <span
            className={`ov-market-delta num is-${summary.live ? pnlTone : "flat"}${
              !summary.live ? " is-offline-pill" : ""
            }`}
          >
            {summary.live
              ? `${formatSignedInr(summary.pnl)} · ${formatPercent(summary.pnlPercent)}`
              : "Not connected"}
          </span>
        </div>
        <div className="ov-market-cell">
          <span className="ov-market-label">Triggers</span>
          <span className="ov-market-value num">{triggerCount}</span>
          <span className="ov-market-delta is-flat">
            {recommendations.length} graded · {gttReady.length} GTT
          </span>
        </div>
        <div className="ov-market-cell">
          <span className="ov-market-label">Slots / alerts</span>
          <span className="ov-market-value num">
            {openSlots}
            <span className="ov-market-of">/{maxSlots}</span>
          </span>
          <div className="ov-slots-meter" aria-hidden="true">
            <span className="ov-slots-fill" style={{ width: `${slotsUsedPct}%` }} />
          </div>
          <span className="ov-market-delta is-flat">
            {heldCount} held · <a href="#/alerts">{unread} alerts</a>
          </span>
        </div>
      </div>

      <div className="ov-focus">
        <div className="ov-focus-head">
          <h2>{triggerCount > 0 ? "Active triggers" : "Top graded setups"}</h2>
          <a href="#/recommendations">Full list →</a>
        </div>

        {!isLive ? (
          <p className="ov-note" role="status">
            <span className="ov-note-label">Sample data</span>
            <span className="ov-note-text">
              Rankings until Kite is connected — levels are not executable.
            </span>
          </p>
        ) : null}

        {focusList.length === 0 ? (
          <p className="ov-empty">No setups to show yet.</p>
        ) : (
          <div className="ov-setups">
            {focusList.map((security) => {
              const setup = setups[security.symbol];
              const quote = market.quotes[security.symbol];
              const price = quote?.lastPrice ?? null;
              const isTrigger = setup?.triggerTier != null;
              const sizeBits =
                isTrigger && setup?.suggestedQty != null
                  ? [
                      { label: "Qty", value: String(setup.suggestedQty) },
                      {
                        label: "Capital",
                        value:
                          setup.entryPrice != null
                            ? formatInr(setup.capitalUsed ?? setup.suggestedQty * setup.entryPrice)
                            : "—",
                      },
                      {
                        label: "R",
                        value: setup.riskRewardTo12Pct != null ? setup.riskRewardTo12Pct.toFixed(2) : "—",
                      },
                    ]
                  : null;

              return (
                <article
                  key={security.symbol}
                  className={`ov-setup ${isTrigger ? `is-${setup.triggerTier}` : "is-watch"}`}
                >
                  <div className="ov-setup-head">
                    <div className="ov-setup-id">
                      <div className="ov-setup-title">
                        <a className="ov-symbol" href={`#/recommendations/${security.symbol}`}>
                          {security.symbol}
                        </a>
                        <span className="ov-setup-name">{security.name}</span>
                      </div>
                      <div className="ov-setup-badges">
                        <span className="ov-mini-badge">{security.sector}</span>
                        {security.grade ? <span className="ov-mini-badge is-grade">{security.grade}</span> : null}
                        {setup?.quality != null ? (
                          <span className="ov-mini-badge is-q">Q{setup.quality}</span>
                        ) : null}
                        {!isLive ? <span className="ov-mini-badge is-sample">Sample</span> : null}
                      </div>
                    </div>
                    <div className="ov-setup-aside">
                      <strong className="ov-setup-last num">{price == null ? "—" : formatInr(price)}</strong>
                      <span className={triggerBadgeClass(setup?.triggerTier ?? null, setup?.actionBucket ?? null)}>
                        {triggerBadge(setup?.triggerTier ?? null, setup?.actionBucket ?? null)}
                      </span>
                      {setup?.quality != null ? (
                        <div className="ov-q-meter" aria-hidden="true">
                          <span style={{ width: `${Math.min(100, setup.quality)}%` }} />
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {setup ? <CompactLevels symbol={security.symbol} setup={setup} showRiskReward={isTrigger} /> : null}

                  <div className="ov-setup-foot">
                    {sizeBits ? (
                      <div className="ov-setup-meta-row">
                        {sizeBits.map((bit) => (
                          <span key={bit.label}>
                            <em>{bit.label}</em>
                            <strong className="num">{bit.value}</strong>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="ov-setup-size">{setup?.triggerHint ?? setup?.action ?? "—"}</span>
                    )}
                    <a className="ov-setup-link" href={`#/recommendations/${security.symbol}`}>
                      Open details
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {gttReady.length > 0 && triggerCount > 0 ? (
        <div className="ov-gtt">
          <div className="ov-focus-head">
            <h2>GTT ready</h2>
            <a href="#/recommendations">Set limits →</a>
          </div>
          <ul className="ov-gtt-list">
            {gttReady.map((security) => {
              const setup = setups[security.symbol];
              return (
                <li key={security.symbol}>
                  <a href={`#/recommendations/${security.symbol}`}>
                    <span className="ov-gtt-sym">{security.symbol}</span>
                    <span className="ov-gtt-limit num">
                      {setup?.buyZoneTop == null ? "—" : `≤ ${formatInr(setup.buyZoneTop)}`}
                    </span>
                    {setup?.quality != null ? <span className="ov-gtt-q">Q{setup.quality}</span> : null}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

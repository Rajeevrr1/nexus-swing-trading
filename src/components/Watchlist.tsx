import { useState, type FormEvent } from "react";
import { buildAnalysis, formatInr } from "../analysis";
import { useMarketData } from "../market/MarketData";
import { formatPercent } from "../portfolio";
import { evaluateSwingSetup, sectorStrength, triggerBadge, triggerBadgeClass, type SwingSetup } from "../recommendations/setup";
import { useOpenRiskBook } from "../risk/openBook";
import { useRiskSettings } from "../risk/settings";
import { isRecommendation } from "../scanner";
import { useScanResults } from "../scanner/useScanResults";
import { resolveWatchlistSymbol } from "../watchlist/resolveSymbol";

export function Watchlist({
  symbols,
  onAdd,
  onRemove,
}: {
  symbols: readonly string[];
  onAdd: (symbol: string) => void;
  onRemove: (symbol: string) => void;
}) {
  const market = useMarketData();
  const connected = market.status.connected && !market.needsReconnect;
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const scanned = useScanResults();
  const scanBySymbol = new Map(scanned.map((security) => [security.symbol, security]));
  const riskSettings = useRiskSettings();
  const openBook = useOpenRiskBook();
  const setups: Record<string, SwingSetup> = {};
  for (const symbol of symbols) {
    const scan = scanBySymbol.get(symbol);
    const bars = market.histories[symbol]?.length
      ? market.histories[symbol]
      : connected
        ? []
        : scan
          ? buildAnalysis(scan).bars
          : [];
    if (bars.length >= 50) {
      setups[symbol] = evaluateSwingSetup(bars, market.niftyBars, scan ? sectorStrength(scan) : null, riskSettings, {
        openRiskRupees: openBook.openRiskRupees,
        openSectors: openBook.openSectors,
        sector: scan?.sector ?? null,
        livePrice: market.quotes[symbol]?.lastPrice ?? null,
      });
    }
  }
  const ordered = [...symbols].sort((a, b) => {
    const rank = (setups[b]?.priority ?? -2) - (setups[a]?.priority ?? -2);
    if (rank !== 0) return rank;
    const quality = (setups[b]?.quality ?? 0) - (setups[a]?.quality ?? 0);
    if (quality !== 0) return quality;
    return (scanBySymbol.get(b)?.conviction ?? 0) - (scanBySymbol.get(a)?.conviction ?? 0) || a.localeCompare(b);
  });
  const inUniverse = symbols.filter((symbol) => scanBySymbol.has(symbol)).length;
  const withTriggers = symbols.filter((symbol) => setups[symbol]?.triggerTier != null).length;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const resolved = resolveWatchlistSymbol(query);
    if ("error" in resolved) {
      setMessage({ tone: "bad", text: resolved.error });
      return;
    }
    if (symbols.includes(resolved.symbol)) {
      setMessage({ tone: "bad", text: `${resolved.symbol} is already on the watchlist.` });
      return;
    }
    onAdd(resolved.symbol);
    setQuery("");
    setMessage({ tone: "ok", text: `${resolved.symbol} added to the watchlist.` });
  }

  return (
    <section className="panel watchlist-page" data-page="watchlist" aria-labelledby="watchlist-heading">
      <div className="panel-head watchlist-head">
        <div className="watchlist-hero">
          <p className="ov-brand">NSE swing desk</p>
          <h1 id="watchlist-heading">Watchlist</h1>
          <p className="lede">
            Track names between scans. Prices refresh with Kite; conviction comes from the scanner when the symbol is in
            the Nifty 100 universe.
          </p>
        </div>
        <p className="count watchlist-count">
          <strong className="num">{symbols.length}</strong>
          <span>
            symbols
            <br />
            saved
          </span>
        </p>
      </div>

      <div className="watchlist-summary" aria-label="Watchlist summary">
        <article className="watchlist-stat">
          <span>Total symbols</span>
          <strong className="num">{symbols.length}</strong>
        </article>
        <article className="watchlist-stat is-universe">
          <span>In Nifty 100</span>
          <strong className="num">{inUniverse}</strong>
        </article>
        <article className="watchlist-stat is-triggers">
          <span>Active triggers</span>
          <strong className="num">{withTriggers}</strong>
        </article>
      </div>

      <form className="add-form watch-add" onSubmit={onSubmit}>
        <label>
          <span>Symbol or name</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="WIPRO or Infosys"
            autoComplete="off"
          />
        </label>
        <button type="submit">Add to watchlist</button>
        {message ? (
          <p className={message.tone === "bad" ? "form-note tone-text-weak" : "form-note"} role="status">
            {message.text}
          </p>
        ) : (
          <p className="form-note">Saved in this browser, so the list is still here next time.</p>
        )}
      </form>

      {symbols.length === 0 ? (
        <div className="watchlist-empty">
          <div className="watchlist-empty-icon" aria-hidden="true">
            <svg viewBox="0 0 48 48" fill="none">
              <rect x="9" y="11" width="30" height="26" rx="9" fill="#dbeafe" stroke="#2563eb" strokeWidth="1.75" />
              <path d="M17 19h14M17 24h10M17 29h7" stroke="#2563eb" strokeWidth="1.75" strokeLinecap="round" />
              <circle cx="33" cy="33" r="8" fill="#ffffff" stroke="#2563eb" strokeWidth="1.75" />
              <path d="M33 29.5v7M29.5 33h7" stroke="#2563eb" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </div>
          <h2>No symbols yet</h2>
          <p>Add an NSE ticker or a name from the scanner universe to start tracking setups between scans.</p>
          <p className="watchlist-empty-cta">Use the form above to add your first symbol.</p>
        </div>
      ) : (
        <div className="watch-grid" aria-label="Watchlist">
          {ordered.map((symbol) => {
            const scan = scanBySymbol.get(symbol);
            const quote = market.quotes[symbol];
            const dayChange =
              quote && quote.previousClose > 0
                ? (quote.lastPrice - quote.previousClose) / quote.previousClose
                : null;
            const rec = scan != null && isRecommendation(scan);
            const setup = setups[symbol] ?? null;
            const bars = market.histories[symbol]?.length
              ? market.histories[symbol]
              : !connected && scan
                ? buildAnalysis(scan).bars
                : [];
            const sparkTone: "up" | "down" | "flat" =
              dayChange == null ? "flat" : dayChange > 0 ? "up" : dayChange < 0 ? "down" : "flat";
            const hasTrigger = setup?.triggerTier != null;
            const rs =
              setup?.relativeStrength == null ? null : `${(setup.relativeStrength * 100).toFixed(1)}%`;
            const emaStatus =
              setup == null
                ? null
                : setup.pullback
                  ? "Pullback zone"
                  : setup.emaSpreadPct != null
                    ? `EMA spread ${setup.emaSpreadPct.toFixed(1)}%`
                    : setup.outperforms
                      ? "Ahead of Nifty"
                      : "Watching EMA";
            const priceLabel =
              quote && connected
                ? formatInr(quote.lastPrice)
                : connected && market.loading
                  ? "Loading…"
                  : connected
                    ? "No quote"
                    : "—";

            return (
              <article
                key={symbol}
                className={`watch-card${hasTrigger ? " is-trigger" : ""}${rec ? " is-rec" : ""}`}
                data-symbol={symbol}
              >
                <div className="watch-card-top">
                  <strong className="watch-card-symbol">{symbol}</strong>
                  <div className="watch-card-price-block">
                    <WatchSpark closes={bars.slice(-14).map((bar) => bar.close)} tone={sparkTone} />
                    <span className="watch-card-price num">{priceLabel}</span>
                    {dayChange != null ? (
                      <span className={`watch-card-change num ${dayChange >= 0 ? "is-up" : "is-down"}`}>
                        {formatPercent(dayChange)}
                      </span>
                    ) : null}
                    {quote && connected ? <span className="source-tag is-live">Live</span> : null}
                    <button
                      type="button"
                      className="watch-remove"
                      onClick={() => onRemove(symbol)}
                      aria-label={`Remove ${symbol}`}
                      title="Remove"
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </div>
                </div>

                <div className="watch-card-meta">
                  <span className="watch-card-name">{scan?.name ?? symbol}</span>
                  <span className="watch-card-sector">{scan?.sector ?? "Off universe"}</span>
                </div>

                <div className="watch-card-metrics">
                  <div className="watch-metric">
                    <span className="watch-metric-label">Conviction</span>
                    <span className="watch-metric-value">
                      {scan ? (
                        <>
                          <strong className="num">{scan.conviction}</strong>
                          {scan.grade ? (
                            <span className={`grade tone-${scan.tone} watch-grade`}>
                              <span className="grade-letter">{scan.grade}</span>
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="watch-muted">Off scan</span>
                      )}
                    </span>
                  </div>
                  <div className="watch-metric">
                    <span className="watch-metric-label">RS vs Nifty</span>
                    <span className="watch-metric-value num">{rs ?? "n/a"}</span>
                  </div>
                  <div className="watch-metric">
                    <span className="watch-metric-label">EMA status</span>
                    <span className="watch-metric-value">{emaStatus ?? "—"}</span>
                  </div>
                  <div className="watch-metric">
                    <span className="watch-metric-label">Stance</span>
                    <span className="watch-metric-value">
                      {scan ? (
                        <span className={`watch-status tone-text-${scan.tone}`}>{scan.stance}</span>
                      ) : (
                        <span className="watch-muted">No scanner data</span>
                      )}
                    </span>
                  </div>
                </div>

                <div className="watch-card-footer">
                  <div className="watch-card-tags">
                    {setup ? (
                      <span className={triggerBadgeClass(setup.triggerTier, setup.actionBucket)}>
                        {triggerBadge(setup.triggerTier, setup.actionBucket)}
                        {setup.triggerHint ? ` · ${setup.triggerHint}` : ""}
                        {setup.triggerTier && setup.maxChasePrice != null && setup.targetPrice != null
                          ? ` · Max Buy ${formatInr(setup.maxChasePrice)} · Target ${formatInr(setup.targetPrice)} (${setup.riskRewardTo12Pct?.toFixed(2)}R)`
                          : ""}
                      </span>
                    ) : null}
                    {rec ? (
                      <span className="watch-rec-tag" title="Also on Recommendations">
                        On Recommendations
                      </span>
                    ) : null}
                  </div>
                  <div className="watch-actions">
                    {scan ? (
                      <a className="dash-link" href={`#/recommendations/${symbol}`}>
                        Open
                      </a>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function WatchSpark({ closes, tone }: { closes: readonly number[]; tone: "up" | "down" | "flat" }) {
  if (closes.length >= 2) {
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const span = Math.max(max - min, 1e-6);
    const points = closes
      .map((close, index) => {
        const x = (index / (closes.length - 1)) * 48;
        const y = 16 - ((close - min) / span) * 14 - 1;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
    return (
      <svg className={`watch-spark is-${tone}`} viewBox="0 0 48 16" aria-hidden="true">
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  const line =
    tone === "up"
      ? "M1 14 L8 11 L16 12 L24 7 L32 8 L40 4 L47 2"
      : tone === "down"
        ? "M1 2 L8 5 L16 4 L24 9 L32 8 L40 12 L47 14"
        : "M1 8 L8 9 L16 7 L24 8 L32 9 L40 8 L47 8";
  return (
    <svg className={`watch-spark is-${tone}`} viewBox="0 0 48 16" aria-hidden="true">
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

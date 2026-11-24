import { useEffect, useState } from "react";
import { formatInr } from "../analysis";
import { AUTO_REFRESH_OPTIONS, type AutoRefreshOption } from "../market/autoRefresh";
import { useMarketData } from "../market/MarketData";
import { evaluateMarketRegime, marketStatus, type MarketStatus } from "../market/status";

/** Compact top-bar clock: `23 Nov · 9:53 pm` */
function formatTopBarTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "";
  const dayPeriod = parts.find((part) => part.type === "dayPeriod")?.value?.toLowerCase() ?? "";
  return `${day} ${month} · ${hour}:${minute} ${dayPeriod}`;
}

export function TopBar() {
  const market = useMarketData();
  const [status, setStatus] = useState<MarketStatus>(() => marketStatus());
  const [, setTick] = useState(0);
  const connected = market.status.connected && !market.needsReconnect;
  const autoLive =
    connected && market.autoRefreshMs > 0 && status.phase === "open" && !market.needsReconnect;
  const regime = evaluateMarketRegime(market.niftyBars);

  useEffect(() => {
    const timer = window.setInterval(() => setStatus(marketStatus()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!autoLive) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [autoLive]);

  const secondsToNext =
    autoLive && market.lastRefreshAt
      ? Math.max(0, Math.ceil((market.autoRefreshMs - (Date.now() - Date.parse(market.lastRefreshAt))) / 1000))
      : null;

  const niftyBar = market.niftyBars[market.niftyBars.length - 1];
  const prevNiftyBar = market.niftyBars[market.niftyBars.length - 2];
  const niftyQuote = market.quotes["NIFTY"];
  const niftyPrice = niftyQuote?.lastPrice ?? niftyBar?.close ?? null;
  const niftyPrev = niftyQuote?.previousClose ?? prevNiftyBar?.close ?? null;
  const niftyDiff = niftyPrice != null && niftyPrev != null && niftyPrev > 0 ? niftyPrice - niftyPrev : null;
  const niftyPct = niftyPrice != null && niftyPrev != null && niftyPrev > 0 ? (niftyDiff! / niftyPrev) * 100 : null;

  const liveLabel =
    status.phase === "open" ? "LIVE" : status.phase === "premarket" || status.phase === "afterhours" ? status.label : "Market closed";

  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <div className={`session session-${status.phase}`} title={`NSE ${status.clock}`}>
            <span className="session-dot" aria-hidden="true" />
            <span className="session-label">{liveLabel}</span>
          </div>

          {niftyPrice != null ? (
            <div className="topbar-nifty-ticker" title="Nifty 50">
              <span className="nifty-label">NIFTY 50</span>
              <span className="nifty-price num">{formatInr(niftyPrice)}</span>
              {niftyDiff != null && niftyPct != null ? (
                <span className={`nifty-delta num ${niftyDiff >= 0 ? "is-pos" : "is-neg"}`}>
                  {niftyDiff >= 0 ? "+" : ""}
                  {niftyDiff.toFixed(1)} ({niftyDiff >= 0 ? "+" : ""}
                  {niftyPct.toFixed(2)}%)
                </span>
              ) : null}
            </div>
          ) : null}

          <div className={`regime-indicator regime-${regime.tier}`} title={regime.summary}>
            <span className="regime-dot" aria-hidden="true" />
            <span className="regime-badge">{regime.label}</span>
            <span className="regime-desc">
              {regime.tier === "green"
                ? `${regime.primeRiskScale.toFixed(1)}x · 5 slots${regime.extensionWarning ? " · Extended" : ""}`
                : regime.tier === "amber"
                  ? "0.5x · 3 slots"
                  : regime.tier === "red"
                    ? "Cash · 0 entries"
                    : "Unknown · 0 entries"}
            </span>
          </div>
        </div>

        <div className="top-actions">
          <p className="refresh-time">{formatTopBarTime(market.lastRefreshAt)}</p>
          <label className="auto-refresh-control">
            <span className="sr-only">Auto-refresh frequency</span>
            <select
              className="auto-refresh-select"
              value={market.autoRefreshMs}
              onChange={(event) => market.setAutoRefreshMs(Number(event.target.value) as AutoRefreshOption)}
            >
              {AUTO_REFRESH_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  Auto {option.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="refresh-button" onClick={() => void market.refresh()} disabled={market.loading}>
            {market.loading ? "Refreshing" : "Refresh"}
          </button>
          {market.needsReconnect ? (
            <button type="button" className="sample-pill is-reconnect" onClick={market.login}>
              Reconnect
            </button>
          ) : (
            <a className={connected ? "sample-pill is-live" : "sample-pill"} href="#/settings">
              {autoLive ? <span className="live-pulse-dot" aria-hidden="true" /> : null}
              {connected ? "Connected" : "Not connected"}
              {autoLive && secondsToNext != null ? (
                <span className="auto-refresh-countdown" aria-label={`Next quote poll in ${secondsToNext} seconds`}>
                  {market.quotesPolling ? "· live" : `· ${secondsToNext}s`}
                </span>
              ) : null}
            </a>
          )}
        </div>
      </header>
      {market.needsReconnect ? (
        <div className="reconnect-banner" role="status">
          <p>Kite session expired. Reconnect to load today's NSE prices. Sample prices stay on screen until then.</p>
          <button type="button" className="kite-connect" onClick={market.login}>
            Reconnect Kite
          </button>
        </div>
      ) : market.error ? (
        <div className="reconnect-banner" role="alert">
          <p>{market.error}</p>
        </div>
      ) : null}
    </>
  );
}

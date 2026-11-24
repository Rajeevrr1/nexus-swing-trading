import { useEffect, useMemo, useState, type FormEvent } from "react";
import { formatInr } from "../analysis";
import { useMarketData } from "../market/MarketData";
import { HOLD_REVIEW_MESSAGE } from "../strategy/policy";
import { STRATEGY_NOTE } from "../strategy";
import { liveBookPositions, type LiveBookRow } from "../portfolio/liveBook";
import {
  formatPercent,
  formatSignedInr,
  resolveSecurity,
  type HoldingInput,
} from "../portfolio";
import { useScanResults } from "../scanner/useScanResults";
import {
  IconHold,
  IconAverage,
  IconSell,
  IconTrim,
  IconChevronDown,
  IconChevronUp,
  IconChart,
} from "./icons";

export function Portfolio({
  added,
  onAdd,
  onOpenSymbol,
}: {
  added: readonly HoldingInput[];
  onAdd: (holding: HoldingInput) => void;
  onOpenSymbol?: (symbol: string) => void;
}) {
  const market = useMarketData();
  const scanned = useScanResults();
  const connected = market.status.connected && !market.needsReconnect;
  const holdingsLoaded = connected && !market.loading && !market.holdingsError;
  const kiteSymbols = new Set(connected ? market.holdings.map((holding) => holding.symbol) : []);
  const positions = useMemo(
    () =>
      liveBookPositions({
        connected,
        holdings: market.holdings,
        added,
        histories: market.histories,
        quotes: market.quotes,
        niftyBars: market.niftyBars,
        scan: scanned,
        holdingsLoaded,
        persist: false,
      }),
    [added, connected, holdingsLoaded, market.histories, market.holdings, market.niftyBars, market.quotes, scanned],
  );

  useEffect(() => {
    liveBookPositions({
      connected,
      holdings: market.holdings,
      added,
      histories: market.histories,
      quotes: market.quotes,
      niftyBars: market.niftyBars,
      scan: scanned,
      holdingsLoaded,
      persist: true,
    });
  }, [added, connected, holdingsLoaded, market.histories, market.holdings, market.niftyBars, market.quotes, scanned]);
  const [symbol, setSymbol] = useState("");
  const [entry, setEntry] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  // Triage count summary
  const holdCount = positions.filter((p) => p.technicals.verdict === "HOLD").length;
  const averageCount = positions.filter((p) => p.technicals.verdict === "AVERAGE").length;
  const trimCount = positions.filter((p) => p.technicals.verdict === "TRIM").length;
  const sellCount = positions.filter((p) => p.technicals.verdict === "SELL").length;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const price = Number(entry);
    if (!Number.isFinite(price) || price <= 0) {
      setMessage({ tone: "bad", text: "Enter an entry price above zero." });
      return;
    }
    const resolved = manualSymbol(symbol, scanned);
    if ("error" in resolved) {
      setMessage({ tone: "bad", text: resolved.error });
      return;
    }
    if (kiteSymbols.has(resolved.symbol)) {
      setMessage({ tone: "bad", text: `${resolved.symbol} is already in your Kite holdings.` });
      return;
    }
    onAdd({
      symbol: resolved.symbol,
      entry: price,
      quantity: 1,
      source: "added",
    });
    setSymbol("");
    setEntry("");
    setMessage({
      tone: "ok",
      text: `${resolved.symbol} saved at ${formatInr(price)} (persisted on this device).`,
    });
  }

  return (
    <section className="panel portfolio-page" data-page="portfolio" aria-labelledby="portfolio-heading">
      <div className="panel-head portfolio-head">
        <div className="portfolio-hero">
          <p className="ov-brand">NSE swing book</p>
          <h1 id="portfolio-heading">Portfolio</h1>
          <p className="strategy-note">{STRATEGY_NOTE}</p>
          <p className="lede">
            {connected
              ? "Live holdings from your Zerodha Kite account. Each position includes real-time technical analysis and an algorithmic verdict: Hold, Average on pullback, Trim profits, or Sell to preserve capital."
              : "Connect Kite to load your holdings. Positions added here stay in memory for this session."}
          </p>
          {market.holdingsError ? <p className="feed-note">{market.holdingsError}</p> : null}
        </div>
        <p className="count portfolio-count">
          <strong className="num">{positions.length}</strong>
          <span>
            open
            <br />
            positions
          </span>
        </p>
      </div>

      {/* Action Triage Signal Cards */}
      <div className="portfolio-triage-grid">
        <div className="triage-card triage-hold">
          <div className="triage-header">
            <span className="triage-icon"><IconHold /></span>
            <span className="triage-title">HOLD TREND</span>
          </div>
          <div className="triage-body">
            <strong className="triage-count num">{holdCount}</strong>
            <p className="triage-desc">Riding above EMA 20 with trend intact</p>
          </div>
        </div>

        <div className="triage-card triage-average">
          <div className="triage-header">
            <span className="triage-icon"><IconAverage /></span>
            <span className="triage-title">AVERAGE / DIP</span>
          </div>
          <div className="triage-body">
            <strong className="triage-count num">{averageCount}</strong>
            <p className="triage-desc">EMA 20 retest with quiet volume (Add)</p>
          </div>
        </div>

        <div className="triage-card triage-trim">
          <div className="triage-header">
            <span className="triage-icon"><IconTrim /></span>
            <span className="triage-title">BOOK 50% (T1)</span>
          </div>
          <div className="triage-body">
            <strong className="triage-count num">{trimCount}</strong>
            <p className="triage-desc">T1 +6% reached — book 50% &amp; trail T2 on EMA 20</p>
          </div>
        </div>

        <div className="triage-card triage-sell">
          <div className="triage-header">
            <span className="triage-icon"><IconSell /></span>
            <span className="triage-title">SELL / EXIT NOW</span>
          </div>
          <div className="triage-body">
            <strong className="triage-count num">{sellCount}</strong>
            <p className="triage-desc">Hard stop, protective stop, EMA 20, or 10d dead money (&lt; +2%)</p>
          </div>
        </div>
      </div>

      <form className="add-form" onSubmit={onSubmit}>
        <label>
          <span>Symbol or name</span>
          <input
            value={symbol}
            onChange={(event) => setSymbol(event.target.value)}
            placeholder="INFY"
            autoComplete="off"
          />
        </label>
        <label>
          <span>Entry price</span>
          <input
            value={entry}
            onChange={(event) => setEntry(event.target.value)}
            inputMode="decimal"
            placeholder="3500"
          />
        </label>
        <button type="submit">Add position</button>
        {message ? (
          <p className={message.tone === "bad" ? "form-note tone-text-weak" : "form-note"} role="status">
            {message.text}
          </p>
        ) : (
          <p className="form-note">Saved in this browser.</p>
        )}
      </form>

      <div className="book" role="table" aria-label="Positions">
        <div className="book-head" role="row">
          <span>Stock</span>
          <span>Average</span>
          <span>Current</span>
          <span>Profit / loss</span>
          <span>Technical Action</span>
        </div>
        {positions.length === 0 ? (
          <div className="book-empty">
            <p>
              {market.loading
                ? "Loading holdings from Kite…"
                : connected
                  ? "Kite returned no holdings."
                  : "Connect Kite to load your holdings."}
            </p>
            {connected ? null : (
              <button type="button" className="kite-connect" onClick={market.login}>
                Connect Kite
              </button>
            )}
          </div>
        ) : (
          positions.map((position) => (
            <PositionLine
              key={`${position.source}-${position.symbol}`}
              position={position}
              onOpenSymbol={onOpenSymbol}
            />
          ))
        )}
      </div>

      <ul className="legend portfolio-legend">
        <li>
          <span className="legend-swatch tone-fill-strong" />
          <strong>Profit zone</strong> · Display only. A target or a red/heavy give-back after +6% means consider exiting the full position
        </li>
        <li>
          <span className="legend-swatch tone-fill-watch" />
          <strong>Runner zone</strong> · After +6%, a close under max(entry, EMA 20) is a full exit
        </li>
        <li>
          <span className="legend-swatch tone-fill-weak" />
          <strong>Full exit</strong> · Close through the hard stop or the entry +1.5% stop after a +6% peak, a close under EMA 20, or 10 sessions. Stops are checked on the close
        </li>
      </ul>
    </section>
  );
}

function manualSymbol(
  query: string,
  universe: Parameters<typeof resolveSecurity>[1],
): { symbol: string } | { error: string } {
  const trimmed = query.trim();
  if (/^[A-Za-z][A-Za-z0-9-]{0,24}$/.test(trimmed)) return { symbol: trimmed.toUpperCase() };
  const resolved = resolveSecurity(trimmed, universe);
  if ("error" in resolved) return { error: "Enter an NSE symbol such as INFY." };
  return { symbol: resolved.match.symbol };
}

function PositionLine({
  position,
  onOpenSymbol,
}: {
  position: LiveBookRow;
  onOpenSymbol?: (symbol: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const pnlTone = position.pnl > 0 ? "strong" : position.pnl < 0 ? "weak" : "watch";
  const { tranchePlan, technicals } = position;
  const gain = position.pnlPercent;
  const t1Percent = gain <= 0 ? 0 : Math.min(100, Math.round((gain / 0.06) * 100));
  const t1Label =
    gain >= 0.06
      ? `+${(gain * 100).toFixed(1)}% · ARMED ✓`
      : gain > 0
        ? `+${(gain * 100).toFixed(1)}% / +6% (${t1Percent}%)`
        : "0.0% / +6%";

  const t2Percent = gain <= 0 ? 0 : Math.min(100, Math.round((gain / 0.12) * 100));
  const t2Label =
    gain >= 0.12
      ? `+${(gain * 100).toFixed(1)}% · TARGET 🎯`
      : gain >= 0.06
        ? `+${(gain * 100).toFixed(1)}% · BE PROTECTED 🛡️`
        : gain > 0
          ? `+${(gain * 100).toFixed(1)}% / +12% (${t2Percent}%)`
          : "Trailing EMA 20";

  const verdict = technicals.verdict;

  return (
    <article className={`book-row ${expanded ? "row-expanded" : ""}`} role="row" data-symbol={position.symbol} data-signal={position.signal.id}>
      <div className="book-name">
        {onOpenSymbol ? (
          <button
            type="button"
            className="ticker ticker-link-btn"
            onClick={() => onOpenSymbol(position.symbol)}
            title={`Open ${position.symbol} chart & technical detail`}
          >
            {position.symbol} ↗
          </button>
        ) : (
          <span className="ticker">{position.symbol}</span>
        )}
        <span>{position.name || position.exchange}{position.source === "added" ? " · Added" : ""}</span>
        <p>
          {position.signal.id === "wait"
            ? "EMA 20 is loading from Kite"
            : `${position.emaSource === "live" ? "Live" : "EMA"} 20 ${formatInr(position.ema20)}`}
          {technicals.distanceToEma20Pct != null ? (
            <span className={technicals.distanceToEma20Pct >= 0 ? "dist-pos" : "dist-neg"}>
              {" "}({technicals.distanceToEma20Pct >= 0 ? "+" : ""}{technicals.distanceToEma20Pct}%)
            </span>
          ) : null}
        </p>
        {position.holdReview ? (
          <p className="hold-review" role="status">
            {HOLD_REVIEW_MESSAGE}
          </p>
        ) : null}
      </div>

      <div className="book-metric">
        <span className="book-label">Entry</span>
        <strong className="num">{formatInr(position.entry)}</strong>
        <p className="num">
          {position.quantity} {position.quantity === 1 ? "share" : "shares"}
          {position.t1Quantity > 0 ? ` · ${position.t1Quantity} in T1` : ""}
        </p>
      </div>

      <div className="book-metric">
        <span className="book-label">Current</span>
        {position.quoteMissing ? (
          <>
            <strong>No Kite quote</strong>
            <p>Live price failed</p>
          </>
        ) : (
          <>
            <strong className="num">{formatInr(position.lastClose)}</strong>
            <p>{position.priceSource === "live" ? "Live price" : "Price unavailable"}</p>
          </>
        )}
      </div>

      <div className="book-metric book-metric-pnl">
        <span className="book-label">Profit / loss</span>
        {position.quoteMissing ? (
          <strong>—</strong>
        ) : (
          <>
            <strong className={`num tone-text-${pnlTone}`}>{formatSignedInr(position.pnl)}</strong>
            <p className={`num tone-text-${pnlTone}`}>{formatPercent(position.pnlPercent)}</p>
          </>
        )}
      </div>

      <div className="book-signal">
        {/* Prominent Action Verdict Card */}
        <div className="action-verdict-box">
          <span className={`action-verdict-badge verdict-${verdict.toLowerCase()}`}>
            {verdict === "HOLD" && <IconHold />}
            {verdict === "AVERAGE" && <IconAverage />}
            {verdict === "TRIM" && <IconTrim />}
            {verdict === "SELL" && <IconSell />}
            {technicals.verdictLabel}
          </span>
        </div>

        {/* Tranche Progress Bars */}
        <div className="tranche-meter-box">
          <div className="tranche-meter-row">
            <div className="tranche-meter-head">
              <span className="tranche-meter-title">Profit zone</span>
              <span className={`tranche-meter-val ${gain >= 0.06 ? "is-armed" : ""}`}>{t1Label}</span>
            </div>
            <div className="tranche-track">
              <div
                className={`tranche-fill ${gain >= 0.06 ? "is-complete" : gain > 0 ? "is-progress" : "is-flat"}`}
                style={{ width: `${t1Percent}%` }}
              />
            </div>
          </div>
          {tranchePlan.t2.quantity > 0 ? (
            <div className="tranche-meter-row">
              <div className="tranche-meter-head">
                <span className="tranche-meter-title">Runner zone</span>
                <span className={`tranche-meter-val ${gain >= 0.06 ? "is-protected" : ""}`}>{t2Label}</span>
              </div>
              <div className="tranche-track">
                <div
                  className={`tranche-fill is-runner ${gain >= 0.12 ? "is-target" : gain >= 0.06 ? "is-be" : ""}`}
                  style={{ width: `${t2Percent}%` }}
                />
              </div>
            </div>
          ) : null}
        </div>

        {/* Tranche Pills */}
        <div className="tranche-split-row">
          <span className={`tranche-pill tone-${tranchePlan.t1.tone}`}>
            T1: {tranchePlan.t1.label}
          </span>
          {tranchePlan.t2.quantity > 0 ? (
            <span className={`tranche-pill tone-${tranchePlan.t2.tone}`}>
              T2: {tranchePlan.t2.label}
            </span>
          ) : null}
        </div>

        <p className="tranche-summary">{technicals.summary}</p>

        {/* Toggle Detailed Technical Analysis */}
        <button
          type="button"
          className="btn-technical-toggle"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
        >
          <IconChart />
          <span>{expanded ? "Hide Technical Analysis" : "Technical Analysis & Chart Plan"}</span>
          {expanded ? <IconChevronUp /> : <IconChevronDown />}
        </button>
      </div>

      {/* Expandable High-Level Technical Analysis Drawer */}
      {expanded ? (
        <div className={`technical-expansion-card is-${verdict.toLowerCase()}`}>
          <div className={`technical-card-head is-${verdict.toLowerCase()}`}>
            <div className="card-verdict-title">
              <span className={`badge-indicator verdict-${verdict.toLowerCase()}`} />
              <strong>
                <span className="card-verdict-kicker">Algorithmic Verdict</span>
                <span className="card-verdict-label">{technicals.verdictLabel}</span>
              </strong>
            </div>
            <p className="card-verdict-desc">{technicals.rationale}</p>
          </div>

          {/* 4 Technical Pillars Matrix */}
          <div className="technical-pillars-grid">
            <div className="pillar-item">
              <span className="pillar-label">📈 Trend Structure</span>
              <strong className={`pillar-val tone-text-${technicals.trendTone}`}>
                {technicals.trendStatus}
              </strong>
            </div>
            <div className="pillar-item">
              <span className="pillar-label">⚡ RSI Momentum (14)</span>
              <strong className={`pillar-val num tone-text-${technicals.rsiTone}`}>
                {technicals.rsi != null ? `${technicals.rsi} · ${technicals.rsiLabel}` : "Loading..."}
              </strong>
            </div>
            <div className="pillar-item">
              <span className="pillar-label">🚀 Relative Strength (vs Nifty)</span>
              <strong className={`pillar-val tone-text-${technicals.rsTone}`}>
                {technicals.rsLabel}
              </strong>
            </div>
            <div className="pillar-item">
              <span className="pillar-label">📊 Volume Profile (RVOL)</span>
              <strong className={`pillar-val tone-text-${technicals.volumeTone}`}>
                {technicals.volumeLabel}
              </strong>
            </div>
          </div>

          {/* Dynamic Technical Price Levels */}
          <div className="technical-levels-box">
            <span className="levels-title">Key Dynamic Technical Levels</span>
            <div className="levels-row">
              <div className="level-badge level-stop">
                <span>Stop Loss</span>
                <strong className="num">{technicals.stopLevel ? formatInr(technicals.stopLevel) : "EMA 20 Breach"}</strong>
                <em className="level-note">Stop checked on close</em>
              </div>
              <div className="level-badge level-support">
                <span>Dynamic Support (EMA 20)</span>
                <strong className="num">{technicals.ema20 ? formatInr(technicals.ema20) : formatInr(technicals.support)}</strong>
              </div>
              <div className="level-badge level-current">
                <span>Current LTP</span>
                <strong className="num">{formatInr(position.lastClose)}</strong>
              </div>
              <div className="level-badge level-resistance">
                <span>Overhead Resistance</span>
                <strong className="num">{formatInr(technicals.resistance)}</strong>
              </div>
              <div className="level-badge level-target">
                <span>+12% Target (T2)</span>
                <strong className="num">{technicals.targetLevel ? formatInr(technicals.targetLevel) : "—"}</strong>
              </div>
            </div>
          </div>

          {/* Action Specific Guidance Banner */}
          {verdict === "AVERAGE" ? (
            <div className="guidance-banner guidance-average">
              <strong>💡 Average Down / Accumulation Blueprint:</strong>
              <p>
                This stock is holding strong above its rising 20 EMA on quiet institutional volume. If capital allocation allows, this is a prime low-risk window to add 25%–50% to your position. Place an immediate protective GTT stop at {formatInr(technicals.stopLevel!)}.
              </p>
            </div>
          ) : verdict === "SELL" ? (
            <div className="guidance-banner guidance-sell">
              <strong>⚠️ Capital Preservation Rule Enforced:</strong>
              <p>
                The stock closed below its 20 EMA ({technicals.ema20 ? formatInr(technicals.ema20) : "n/a"}). In swing trading, averaging down on a broken trend multiplies loss exposure. Sell/exit across all shares now to keep trading capital safe for fresh leaders.
              </p>
            </div>
          ) : verdict === "TRIM" ? (
            <div className="guidance-banner guidance-trim">
              <strong>🎯 Profit Harvesting Blueprint:</strong>
              <p>
                Target zone reached (+{(gain * 100).toFixed(1)}%). Consider exiting the full position. The desk does not sell a partial. A later close under the runner stop is also a full exit.
              </p>
            </div>
          ) : (
            <div className="guidance-banner guidance-hold">
              <strong>🛡️ Trend Runner Guidance:</strong>
              <p>
                Trend structure is healthy and riding above EMA 20. No exit is active. The next checks are +6% on a red or heavy down close, the full target, and a close under the runner stop.
              </p>
            </div>
          )}
        </div>
      ) : null}
    </article>
  );
}

import { useEffect, useState } from "react";
import { buildAnalysis, formatInr } from "../analysis";
import {
  periodFetchDays,
  ROUND_TRIP_FRICTION,
  runBacktest,
  type BacktestPeriod,
  type BacktestReport,
  type SegmentId,
  type SegmentResult,
} from "../backtest/engine";
import { fetchKiteHistory } from "../market/kiteClient";
import { syntheticNiftyFromUniverse } from "../market/syntheticNifty";
import { useMarketData } from "../market/MarketData";
import { formatPercent } from "../portfolio";
import { resolveScanResults } from "../scanner";
import { STRATEGY_NOTE } from "../strategy";

const PERIODS: { id: BacktestPeriod; label: string }[] = [
  { id: "6m", label: "Last 6 Months" },
  { id: "1y", label: "Last 1 Year" },
  { id: "3.5y", label: "Last 3.5 Years" },
];

const FETCH_DAYS = periodFetchDays("3.5y");

export function Backtest() {
  const market = useMarketData();
  const connected = market.status.connected && !market.needsReconnect;
  const [period, setPeriod] = useState<BacktestPeriod>("3.5y");
  const [reports, setReports] = useState<{
    six: BacktestReport;
    year: BacktestReport;
    long: BacktestReport;
  } | null>(null);
  const [segmentId, setSegmentId] = useState<SegmentId>("pullback-desk");
  const [book, setBook] = useState<"gross" | "net">("gross");
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const securities = resolveScanResults(
      market.histories,
      market.niftyBars,
      market.status.connected && !market.needsReconnect,
    );

    async function load() {
      setLoading(true);
      setNote(null);
      const finish = (
        histories: Record<string, ReturnType<typeof buildAnalysis>["bars"]>,
        source: "kite" | "sample",
        nifty: ReturnType<typeof buildAnalysis>["bars"],
      ) => {
        if (cancelled) return;
        setReports({
          six: runBacktest({ period: "6m", source, securities, histories, nifty }),
          year: runBacktest({ period: "1y", source, securities, histories, nifty }),
          long: runBacktest({ period: "3.5y", source, securities, histories, nifty }),
        });
      };
      try {
        if (connected) {
          const histories = await fetchKiteHistory(
            [...securities.map((security) => security.symbol), "NIFTY"],
            FETCH_DAYS,
          );
          const lengths = Object.values(histories).map((bars) => bars.length);
          const median = lengths.sort((a, b) => a - b)[Math.floor(lengths.length / 2)] ?? 0;
          finish(histories, "kite", histories.NIFTY ?? []);
          if (Object.keys(histories).length === 0) {
            setNote("Kite returned no daily candles for the scanned names.");
          } else if (median < 600) {
            setNote(
              `Kite history looks short for 3.5 years (median ${median} bars). Connect and refresh, or wait for the long fetch to finish.`,
            );
          }
        } else {
          const sampleHistories = Object.fromEntries(
            securities.map((security) => [security.symbol, buildAnalysis(security).bars]),
          );
          finish(sampleHistories, "sample", syntheticNiftyFromUniverse(sampleHistories));
          setNote(
            "Kite is not connected. Sample series is only ~80 bars — connect Kite to run a real 3.5-year backtest.",
          );
        }
      } catch (caught) {
        const sampleHistories = Object.fromEntries(
          securities.map((security) => [security.symbol, buildAnalysis(security).bars]),
        );
        finish(sampleHistories, "sample", syntheticNiftyFromUniverse(sampleHistories));
        setNote(caught instanceof Error ? caught.message : "Kite history failed. Showing the sample series.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [connected, market.histories, market.niftyBars, market.status.connected]);

  const result = period === "3.5y" ? reports?.long : period === "1y" ? reports?.year : reports?.six;
  const selected = result?.segments.find((segment) => segment.id === segmentId) ?? result?.segments[0] ?? null;
  const bestSegmentId = bestProfitFactorId(result?.segments ?? [], book);
  const activeFactor = selected
    ? book === "net"
      ? selected.netProfitFactor
      : selected.profitFactor
    : null;
  const activeReturn = selected
    ? book === "net"
      ? selected.netTotalReturn
      : selected.totalReturn
    : 0;
  const equityTone =
    selected == null
      ? "flat"
      : activeReturn > 0
        ? "up"
        : activeReturn < 0
          ? "down"
          : "flat";

  return (
    <section className="panel backtest-page" data-page="backtest" aria-labelledby="backtest-heading">
      <div className="panel-head backtest-head">
        <div className="backtest-hero">
          <p className="ov-brand">
            Reference report
            <span className="backtest-ref-badge">Reference only</span>
          </p>
          <h1 id="backtest-heading">Backtest</h1>
          <p className="strategy-note">{STRATEGY_NOTE}</p>
          <p className="lede">
            Row one takes every v1.2 pullback with no position limit. Row two applies the v1.3 young-trend filter with full exits. Row three is the v1.4 live desk: Prime-only (EMA spread ≤ 2.5%, point-in-time sector ≥ 55, RVOL ≥ 0.60, ATR ≤ 6%, turnover ≥ ₹20 crore; Standard paused), max five names, two per sector. Exits book 50% (T1) at +6%, raise the runner stop to entry +1.5%, and trail the remaining 50% (T2) freely on close below EMA 20 with no +12% cap; the 10-session time stop exits only dead money (&lt; +2%). Gross is the trade result; Net subtracts {(ROUND_TRIP_FRICTION * 100).toFixed(2)}% NSE delivery cost. Daily mark-to-market equity uses 20% per slot.
          </p>
        </div>
        <div className="period-switch backtest-controls" role="group" aria-label="Backtest view">
          <div className="period-switch cost-toggle backtest-cost" role="tablist" aria-label="Cost basis">
            <button
              type="button"
              role="tab"
              aria-selected={book === "gross"}
              className={book === "gross" ? "refresh-button is-selected" : "refresh-button"}
              onClick={() => setBook("gross")}
            >
              Gross
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={book === "net"}
              className={book === "net" ? "refresh-button is-selected" : "refresh-button"}
              onClick={() => setBook("net")}
            >
              Net of 0.28%
            </button>
          </div>
          <div className="period-switch backtest-periods" role="tablist" aria-label="Backtest period">
            {PERIODS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={period === item.id}
                className={period === item.id ? "refresh-button is-selected" : "refresh-button"}
                onClick={() => setPeriod(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="backtest-note">
        <strong>Reference only</strong>
        <p>
          This is a simplified backtest for reference only.
          {result
            ? result.source === "kite"
              ? " Prices are Kite daily candles, including Nifty 50. Older rows still measure RS against the equal-weight book. The new rows measure it against Nifty."
              : " Kite is not connected, so prices are the sample series and relative volume is unavailable."
            : ""}
        </p>
      </div>
      {result?.source === "sample" ? (
        <div className="backtest-sample-banner" role="status">
          <strong>Sample data</strong>
          <p>Connect Kite for a full-history backtest. Current metrics use the short sample series.</p>
        </div>
      ) : null}
      {note ? (
        <div className="backtest-feed-note" role="status">
          <strong>Connection note</strong>
          <p>{note}</p>
        </div>
      ) : null}
      {loading && !reports ? (
        <p className="backtest-loading">
          Loading up to {FETCH_DAYS} calendar days of daily candles and running 6m / 1y / 3.5y windows…
        </p>
      ) : null}

      {reports ? (
        <div className="compare-wrap">
          <div className="compare-head">
            <div>
              <h2>Strategy comparison</h2>
              <p>Win rate · closed trades · profit factor · expectancy across windows</p>
            </div>
            <p className="compare-guide">
              Baseline = all pullbacks · High-quality = empirical edge filter · Desk = max 5 positions / 2 per sector
            </p>
          </div>
          <table className="compare-table">
            <thead>
              <tr>
                <th>Filter</th>
                <th>Last 6 months</th>
                <th>Last 1 year</th>
                <th>Last 3.5 years</th>
              </tr>
            </thead>
            <tbody>
              {reports.six.segments.map((segment) => {
                const year = reports.year.segments.find((item) => item.id === segment.id);
                const long = reports.long.segments.find((item) => item.id === segment.id);
                const isBest = segment.id === bestSegmentId;
                return (
                  <tr
                    key={segment.id}
                    className={`${segment.id === segmentId ? "is-selected" : ""}${isBest ? " is-best" : ""}`}
                  >
                    <th>
                      <span className="compare-strategy">
                        {isBest ? <span className="compare-rank">#1</span> : null}
                        <span>{segment.label}</span>
                      </span>
                    </th>
                    <td>{metricCell(segment)}</td>
                    <td>{year ? metricCell(year) : "—"}</td>
                    <td>{long ? metricCell(long) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {result && selected ? (
        <>
          <div className="segment-grid" role="tablist" aria-label="Entry filters">
            {result.segments.map((segment) => {
              const isBest = segment.id === bestSegmentId;
              const isSelected = segment.id === selected.id;
              const rank = profitFactorRank(result.segments, segment.id, book);
              return (
                <button
                  key={segment.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  className={`segment-card${isSelected ? " is-selected" : ""}${isBest ? " is-best" : ""}`}
                  onClick={() => setSegmentId(segment.id)}
                >
                  <span className="segment-card-top">
                    <span className="dash-label">{segment.label}</span>
                    {isBest ? <span className="segment-best-tag">Best PF</span> : null}
                  </span>
                  <strong className="num">{headlineFactor(segment, book)}</strong>
                  <span className="segment-pf-meter" aria-hidden="true">
                    <span
                      style={{
                        width: `${pfMeterWidth(book === "net" ? segment.netProfitFactor : segment.profitFactor)}%`,
                      }}
                    />
                  </span>
                  <span className="segment-card-meta">
                    <span className="segment-trade-count">{segment.closed} trades</span>
                    {(segment.id === "ema-rs-vol" ||
                      segment.id === "full" ||
                      segment.id === "relaxed" ||
                      segment.id === "sector") &&
                    !segment.volumeApplied
                      ? " · volume not in this feed"
                      : ""}
                    {rank != null ? <span className="segment-card-rank">#{rank}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="backtest-note backtest-summary">{selected.summary}</p>

          <div className="backtest-equity" aria-hidden="true">
            <div className="backtest-equity-copy">
              <span className="dash-label">{book === "net" ? "Net equity path" : "Equity path"}</span>
              <strong className={`num ${activeReturn < 0 ? "tone-text-weak" : "tone-text-strong"}`}>
                {formatPercent(activeReturn)}
              </strong>
              <span className="backtest-equity-caption">Illustrative path for selected filter</span>
            </div>
            <div className="backtest-equity-chart">
              <EquitySpark tone={equityTone} />
            </div>
          </div>

          <div className="dash-grid backtest-stats">
            <article className="dash-stat">
              <p className="dash-label">Win rate</p>
              <p className="dash-value num">{selected.winRate == null ? "—" : formatPercent(selected.winRate)}</p>
              <p className="dash-meta">
                {selected.closed} closed · {selected.open} open
              </p>
            </article>
            <article className="dash-stat">
              <p className="dash-label">Avg winner / avg loser</p>
              <p className="dash-value dash-value-pair">
                <span className="tone-text-strong num">
                  {selected.averageWinner == null ? "—" : formatPercent(selected.averageWinner)}
                </span>
                <span className="tone-text-weak num">
                  {selected.averageLoser == null ? "—" : formatPercent(selected.averageLoser)}
                </span>
              </p>
            </article>
            <article className={`dash-stat is-factor${activeFactor != null && activeFactor >= 1.2 ? " is-positive" : ""}`}>
              <p className="dash-label">{book === "net" ? "Net profit factor" : "Gross profit factor"}</p>
              <p className="dash-value num">{factorText(activeFactor)}</p>
              <span className="backtest-pf-bar" aria-hidden="true">
                <span style={{ width: `${pfMeterWidth(activeFactor)}%` }} />
              </span>
              <p className="dash-meta">{book === "net" ? "After 0.28% round trip" : `Net ${factorText(selected.netProfitFactor)}`}</p>
            </article>
            <article
              className={`dash-stat${
                (book === "net" ? selected.netExpectancy : selected.expectancy) != null &&
                (book === "net" ? selected.netExpectancy : selected.expectancy)! >= 0
                  ? " is-positive"
                  : ""
              }`}
            >
              <p className="dash-label">{book === "net" ? "Net expectancy" : "Gross expectancy"}</p>
              <p
                className={`dash-value num ${
                  (book === "net" ? selected.netExpectancy : selected.expectancy) != null &&
                  (book === "net" ? selected.netExpectancy : selected.expectancy)! < 0
                    ? "tone-text-weak"
                    : "tone-text-strong"
                }`}
              >
                {(book === "net" ? selected.netExpectancy : selected.expectancy) == null
                  ? "—"
                  : formatPercent((book === "net" ? selected.netExpectancy : selected.expectancy)!)}
              </p>
              <p className="dash-meta">
                {book === "net"
                  ? "After 0.28% round trip"
                  : `Net ${selected.netExpectancy == null ? "—" : formatPercent(selected.netExpectancy)}`}
              </p>
            </article>
            <article className="dash-stat is-drawdown">
              <p className="dash-label">{book === "net" ? "Net max drawdown" : "Max drawdown"}</p>
              <p className="dash-value num">
                {(book === "net" ? selected.netMaxDrawdown : selected.maxDrawdown) == null
                  ? "—"
                  : formatPercent((book === "net" ? selected.netMaxDrawdown : selected.maxDrawdown)!)}
              </p>
              <p className="dash-meta">
                {selected.id === "pullback-desk"
                  ? "Daily mark-to-market equity (20% per slot, max 5 open)"
                  : "Closed trades applied at 20% equity weight, in exit order"}
              </p>
            </article>
            <article className="dash-stat">
              <p className="dash-label">Average holding days</p>
              <p className="dash-value num">
                {selected.averageHoldDays == null ? "—" : selected.averageHoldDays.toFixed(1)}
              </p>
              <p className="dash-meta">Calendar days, entry to exit</p>
            </article>
            <article className="dash-stat">
              <p className="dash-label">Max consecutive losses</p>
              <p className="dash-value num">{selected.maxConsecutiveLosses}</p>
            </article>
            <article className={`dash-stat${activeReturn >= 0 ? " is-positive" : " is-negative"}`}>
              <p className="dash-label">{book === "net" ? "Net total return" : "Total return"}</p>
              <p className={`dash-value num ${activeReturn < 0 ? "tone-text-weak" : "tone-text-strong"}`}>
                {formatPercent(activeReturn)}
              </p>
              <p className="dash-meta">
                {result.symbols} names · {result.windowStart || "—"} to {result.windowEnd || "—"}
              </p>
            </article>
          </div>

          {selected.trades.length === 0 ? (
            <div className="book-empty">
              <p>No setups cleared this filter in the window. Try a looser segment or another period.</p>
            </div>
          ) : (
            <TradeLog trades={selected.trades} closed={selected.closed} open={selected.open} />
          )}
        </>
      ) : null}
    </section>
  );
}

function TradeLog({
  trades,
  closed,
  open,
}: {
  trades: SegmentResult["trades"];
  closed: number;
  open: number;
}) {
  const [view, setView] = useState<"all" | "open" | "closed" | "wins">("all");
  const wins = trades.filter((trade) => trade.result === "Win").length;
  const bestKey = bestTradeKey(trades);
  const visible = trades.filter((trade) => {
    const isOpen = trade.result === "Open" || trade.exitDate == null;
    if (view === "open") return isOpen;
    if (view === "closed") return !isOpen;
    if (view === "wins") return trade.result === "Win";
    return true;
  });

  return (
    <div className="backtest-trades-panel">
      <div className="backtest-trades-toolbar">
        <div>
          <h2>Trade log</h2>
          <p>Closed and open positions for the selected filter</p>
        </div>
        <div className="backtest-trades-legend" aria-label="Trade mix">
          <span className="is-closed">{closed} closed</span>
          <span className="is-open">{open} open</span>
          <span className="is-wins">{wins} wins</span>
        </div>
      </div>

      <div className="backtest-trades-filters" role="tablist" aria-label="Trade filters">
        {(
          [
            { id: "all", label: "All" },
            { id: "open", label: "Open" },
            { id: "closed", label: "Closed" },
            { id: "wins", label: "Wins" },
          ] as const
        ).map((chip) => (
          <button
            key={chip.id}
            type="button"
            role="tab"
            aria-selected={view === chip.id}
            className={view === chip.id ? "is-selected" : undefined}
            onClick={() => setView(chip.id)}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="watch-table backtest-trades" role="table" aria-label="Past trades">
        <div className="bt-head" role="row">
          <span className="bt-sort">Symbol</span>
          <span className="bt-sort">Entry date</span>
          <span>Exit date</span>
          <span className="bt-col-num">Entry price</span>
          <span className="bt-col-num">Exit price</span>
          <span className="bt-sort bt-col-num">P&L %</span>
          <span>Result</span>
          <span>Why</span>
        </div>
        {visible.map((trade) => {
          const isOpen = trade.result === "Open" || trade.exitDate == null;
          const key = `${trade.symbol}-${trade.entryDate}-${trade.reason}`;
          return (
            <article
              key={key}
              className={`bt-row${isOpen ? " is-open" : ""}${trade.result === "Win" ? " is-win" : ""}${
                trade.result === "Loss" ? " is-loss" : ""
              }${key === bestKey ? " is-best" : ""}`}
              data-symbol={trade.symbol}
            >
              <div className="watch-name">
                <span className="ticker">{trade.symbol}</span>
                <span>{trade.name}</span>
              </div>
              <span className="num">{formatDay(trade.entryDate)}</span>
              <span className="num">{trade.exitDate ? formatDay(trade.exitDate) : "Open"}</span>
              <span className="num bt-col-num">{formatInr(trade.entry)}</span>
              <span className="num bt-col-num">{formatInr(trade.exit)}</span>
              <span className={`num bt-pnl bt-col-num ${trade.returnPct >= 0 ? "is-up" : "is-down"}`}>
                {formatPercent(trade.returnPct)}
              </span>
              <span className={`bt-result is-${trade.result.toLowerCase()}`}>{trade.result}</span>
              <span className="bt-why">{trade.why}</span>
            </article>
          );
        })}
        {visible.length === 0 ? (
          <p className="backtest-trades-empty">No trades match this filter.</p>
        ) : null}
      </div>
    </div>
  );
}

function bestTradeKey(trades: SegmentResult["trades"]): string | null {
  let best: SegmentResult["trades"][number] | null = null;
  for (const trade of trades) {
    if (trade.result === "Open" || trade.exitDate == null) continue;
    if (best == null || trade.returnPct > best.returnPct) best = trade;
  }
  return best ? `${best.symbol}-${best.entryDate}-${best.reason}` : null;
}

function metricCell(segment: SegmentResult) {
  const win = segment.winRate == null ? "—" : formatPercent(segment.winRate);
  const hold = segment.averageHoldDays == null ? "—" : `${segment.averageHoldDays.toFixed(1)}d`;
  return (
    <span className="metric-stack num">
      <span>
        Gross {win} · {segment.closed} · PF {factorText(segment.profitFactor)} ·{" "}
        {segment.expectancy == null ? "—" : formatPercent(segment.expectancy)}
      </span>
      <span>
        Net PF {factorText(segment.netProfitFactor)} ·{" "}
        {segment.netExpectancy == null ? "—" : formatPercent(segment.netExpectancy)} · DD{" "}
        {segment.maxDrawdown == null ? "—" : formatPercent(segment.maxDrawdown)} · {hold}
      </span>
    </span>
  );
}

function factorText(value: number | null): string {
  return value == null ? "—" : value.toFixed(2);
}

function headlineFactor(segment: SegmentResult, book: "gross" | "net"): string {
  return factorText(book === "net" ? segment.netProfitFactor : segment.profitFactor);
}

function pfMeterWidth(value: number | null): number {
  if (value == null || !Number.isFinite(value) || value <= 0) return 8;
  return Math.max(8, Math.min(100, (value / 3) * 100));
}

function bestProfitFactorId(segments: readonly SegmentResult[], book: "gross" | "net"): SegmentId | null {
  let bestId: SegmentId | null = null;
  let bestValue = -Infinity;
  for (const segment of segments) {
    const value = book === "net" ? segment.netProfitFactor : segment.profitFactor;
    if (value == null || !Number.isFinite(value)) continue;
    if (value > bestValue) {
      bestValue = value;
      bestId = segment.id;
    }
  }
  return bestId;
}

function profitFactorRank(
  segments: readonly SegmentResult[],
  id: SegmentId,
  book: "gross" | "net",
): number | null {
  const ranked = [...segments]
    .map((segment) => ({
      id: segment.id,
      value: book === "net" ? segment.netProfitFactor : segment.profitFactor,
    }))
    .filter((segment) => segment.value != null && Number.isFinite(segment.value))
    .sort((a, b) => (b.value as number) - (a.value as number));
  const index = ranked.findIndex((segment) => segment.id === id);
  return index >= 0 ? index + 1 : null;
}

function EquitySpark({ tone }: { tone: "up" | "down" | "flat" }) {
  const line =
    tone === "up"
      ? "M2 42 L18 38 L34 40 L50 28 L66 30 L82 18 L98 20 L114 10 L130 12 L146 6"
      : tone === "down"
        ? "M2 8 L18 12 L34 10 L50 22 L66 20 L82 32 L98 30 L114 40 L130 38 L146 44"
        : "M2 24 L18 22 L34 26 L50 24 L66 25 L82 23 L98 26 L114 24 L130 25 L146 24";
  const fill =
    tone === "up"
      ? "M2 42 L18 38 L34 40 L50 28 L66 30 L82 18 L98 20 L114 10 L130 12 L146 6 L146 48 L2 48 Z"
      : tone === "down"
        ? "M2 8 L18 12 L34 10 L50 22 L66 20 L82 32 L98 30 L114 40 L130 38 L146 44 L146 48 L2 48 Z"
        : "M2 24 L18 22 L34 26 L50 24 L66 25 L82 23 L98 26 L114 24 L130 25 L146 24 L146 48 L2 48 Z";
  return (
    <svg className={`backtest-equity-spark is-${tone}`} viewBox="0 0 148 48" preserveAspectRatio="none">
      <g className="backtest-equity-grid" aria-hidden="true">
        <line x1="0" y1="12" x2="148" y2="12" />
        <line x1="0" y1="24" x2="148" y2="24" />
        <line x1="0" y1="36" x2="148" y2="36" />
        <line x1="37" y1="0" x2="37" y2="48" />
        <line x1="74" y1="0" x2="74" y2="48" />
        <line x1="111" y1="0" x2="111" y2="48" />
      </g>
      <path className="backtest-equity-fill" d={fill} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatDay(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

import { useMemo, useState, type FormEvent } from "react";
import { formatInr } from "../analysis";
import { loadJournal, saveJournal } from "../journal/storage";
import { computeStats, isClosed, parseDraft, tradeResult, type JournalTrade, type TradeDraft } from "../journal/stats";
import { recordClosedStandardTrade } from "../monitor/standardPerformance";
import { StandardPerformanceCard } from "./StandardPerformanceCard";
import { useMarketData } from "../market/MarketData";
import { formatPercent, formatSignedInr } from "../portfolio";
import { getUniverse } from "../scanner/universe";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY_DRAFT: TradeDraft = { symbol: "", entryDate: today(), entryPrice: "", qty: "", stopPrice: "", note: "" };

function tone(value: number | null): string {
  if (value == null || value === 0) return "";
  return value > 0 ? "tone-text-strong" : "tone-text-weak";
}

function fmtR(value: number | null): string {
  return value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`;
}

function csvEscape(value: string | number | null): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function Journal() {
  const market = useMarketData();
  const connected = market.status.connected && !market.needsReconnect;
  const [trades, setTrades] = useState<JournalTrade[]>(() => loadJournal());
  const [draft, setDraft] = useState<TradeDraft>(EMPTY_DRAFT);
  const [tier, setTier] = useState<"" | "prime" | "standard">("");
  const [message, setMessage] = useState<string | null>(null);
  const [closing, setClosing] = useState<{ id: string; price: string; date: string } | null>(null);
  const [view, setView] = useState<"all" | "open" | "closed">("all");
  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({});

  const stats = useMemo(() => computeStats(trades), [trades]);
  const equityPoints = useMemo(() => cumulativePnlSeries(trades), [trades]);
  const namesBySymbol = useMemo(
    () => Object.fromEntries(getUniverse().map((security) => [security.symbol, security.name])),
    [],
  );
  const visible = useMemo(() => {
    if (view === "open") return trades.filter((trade) => !isClosed(trade));
    if (view === "closed") return trades.filter((trade) => isClosed(trade));
    return trades;
  }, [trades, view]);

  function commit(next: JournalTrade[]) {
    setTrades(next);
    saveJournal(next);
  }

  function onAdd(event: FormEvent) {
    event.preventDefault();
    const parsed = parseDraft(draft);
    if ("error" in parsed) {
      setMessage(parsed.error);
      return;
    }
    commit([
      {
        ...parsed,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        triggerTier: tier === "" ? null : tier,
      },
      ...trades,
    ]);
    setDraft({ ...EMPTY_DRAFT, entryDate: draft.entryDate });
    setMessage(`${parsed.symbol} logged.`);
  }

  function onClose(event: FormEvent) {
    event.preventDefault();
    if (!closing) return;
    const trade = trades.find((item) => item.id === closing.id);
    const price = Number(closing.price);
    if (!trade) return;
    if (!Number.isFinite(price) || price <= 0) {
      setMessage("Exit price must be greater than 0.");
      return;
    }
    if (Date.parse(closing.date) < Date.parse(trade.entryDate)) {
      setMessage("Exit date cannot be before the entry date.");
      return;
    }
    const next = trades.map((item) =>
      item.id === trade.id ? { ...item, exitPrice: price, exitDate: closing.date } : item,
    );
    commit(next);
    const closed = next.find((item) => item.id === trade.id);
    // Prime and untagged closes stay out of the Standard monitor.
    if (closed?.triggerTier === "standard" && closed.exitDate && closed.exitPrice != null) {
      const result = tradeResult(closed);
      if (result) {
        recordClosedStandardTrade({
          id: closed.id,
          symbol: closed.symbol,
          entryDate: closed.entryDate,
          exitDate: closed.exitDate,
          rMultiple: result.rMultiple,
          pnlPercent: result.pnlPercent,
          result: result.pnlPercent > 0 ? "win" : "loss",
        });
      }
    }
    setClosing(null);
    setMessage(`${trade.symbol} closed.`);
  }

  function exportCsv() {
    const header = ["symbol", "entry_date", "entry_price", "qty", "stop", "exit_date", "exit_price", "pnl", "r_multiple", "note"];
    const rows = trades.map((trade) => {
      const result = tradeResult(trade);
      return [
        trade.symbol,
        trade.entryDate,
        trade.entryPrice,
        trade.qty,
        trade.stopPrice,
        trade.exitDate,
        trade.exitPrice,
        result ? result.pnl.toFixed(2) : null,
        result?.rMultiple != null ? result.rMultiple.toFixed(2) : null,
        trade.note,
      ]
        .map(csvEscape)
        .join(",");
    });
    const blob = new Blob([[header.join(","), ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `nexus-journal-${today()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const field = (key: keyof TradeDraft) => ({
    value: draft[key],
    onChange: (event: { target: { value: string } }) => setDraft((current) => ({ ...current, [key]: event.target.value })),
  });

  const equityTone = stats.totalPnl > 0 ? "up" : stats.totalPnl < 0 ? "down" : "flat";

  return (
    <section className="panel journal-page" data-page="journal" aria-labelledby="journal-heading">
      <div className="panel-head journal-head">
        <div className="journal-hero">
          <p className="ov-brand">NSE swing desk</p>
          <h1 id="journal-heading">Trade Journal</h1>
          <p className="lede">
            Log every trade, close it when you exit, and track what actually works: win rate, profit factor, expectancy
            and R-multiples. Saved in this browser.
          </p>
        </div>
        <button type="button" className="refresh-button journal-export" onClick={exportCsv} disabled={trades.length === 0}>
          Export CSV
        </button>
      </div>

      <div className="journal-summary-row">
        <div className="dash-grid journal-stats">
          <article
            className={`dash-stat${stats.totalPnl > 0 ? " is-positive" : stats.totalPnl < 0 ? " is-negative" : ""}`}
          >
            <p className="dash-label">Realised P&amp;L</p>
            <p className={`dash-value num ${tone(stats.closed ? stats.totalPnl : null)}`}>
              {stats.closed ? formatSignedInr(stats.totalPnl) : formatSignedInr(0)}
            </p>
            <p className="dash-meta">
              {stats.closed} closed · {stats.open} open
            </p>
          </article>
          <article className="dash-stat">
            <p className="dash-label">Win rate</p>
            <p className="dash-value num">
              {stats.winRate == null ? "0%" : `${(stats.winRate * 100).toFixed(0)}%`}
            </p>
            <p className="dash-meta">
              {stats.wins}W · {stats.losses}L
            </p>
          </article>
          <article className={`dash-stat${stats.profitFactor != null && stats.profitFactor >= 1.2 ? " is-positive" : ""}`}>
            <p className="dash-label">Profit factor</p>
            <p className="dash-value num">
              {stats.profitFactor == null ? (stats.wins > 0 ? "∞" : "0.00") : stats.profitFactor.toFixed(2)}
            </p>
            <p className="dash-meta">Gross profit ÷ gross loss</p>
          </article>
          <article
            className={`dash-stat${
              stats.expectancy != null && stats.expectancy > 0
                ? " is-positive"
                : stats.expectancy != null && stats.expectancy < 0
                  ? " is-negative"
                  : ""
            }`}
          >
            <p className="dash-label">Expectancy / trade</p>
            <p className={`dash-value num ${tone(stats.expectancy)}`}>
              {stats.expectancy == null ? formatSignedInr(0) : formatSignedInr(stats.expectancy)}
            </p>
            <p className="dash-meta">Avg R {fmtR(stats.avgR)}</p>
          </article>
        </div>
        <div className="journal-equity" aria-hidden="true">
          <div>
            <span className="dash-label">Cumulative P&amp;L</span>
            <strong className={`num ${tone(stats.closed ? stats.totalPnl : null)}`}>
              {stats.closed ? formatSignedInr(stats.totalPnl) : formatSignedInr(0)}
            </strong>
          </div>
          <JournalSpark points={equityPoints} tone={equityTone} />
        </div>
      </div>

      <StandardPerformanceCard />

      <form className="add-form journal-form" onSubmit={onAdd}>
        <label>
          <span>Symbol</span>
          <input {...field("symbol")} placeholder="INFY" autoComplete="off" />
        </label>
        <label>
          <span>Entry date</span>
          <input type="date" {...field("entryDate")} max={today()} />
        </label>
        <label>
          <span>Entry price</span>
          <input type="number" step="0.05" min="0" {...field("entryPrice")} placeholder="0.00" />
        </label>
        <label>
          <span>Quantity</span>
          <input type="number" step="1" min="1" {...field("qty")} placeholder="0" />
        </label>
        <label>
          <span>Stop (optional)</span>
          <input type="number" step="0.05" min="0" {...field("stopPrice")} placeholder="0.00" />
        </label>
        <label>
          <span>Trigger</span>
          <select value={tier} onChange={(event) => setTier(event.target.value as "" | "prime" | "standard")}>
            <option value="">Untagged</option>
            <option value="prime">Prime</option>
            <option value="standard">Standard</option>
          </select>
        </label>
        <button type="submit">Log trade</button>
        <label className="journal-note">
          <span>Note</span>
          <input {...field("note")} placeholder="Why did you take it?" maxLength={280} />
        </label>
        <p className="form-note" role="status">
          {message ?? "Add a stop to get R-multiples. Stored in localStorage, so it survives closing the tab."}
        </p>
      </form>

      {trades.length === 0 ? (
        <div className="journal-empty">
          <div className="journal-empty-icon" aria-hidden="true">
            <svg viewBox="0 0 48 48" fill="none">
              <rect x="9" y="11" width="30" height="26" rx="9" fill="#dbeafe" stroke="#2563eb" strokeWidth="1.75" />
              <path d="M17 19h14M17 24h11M17 29h8" stroke="#2563eb" strokeWidth="1.75" strokeLinecap="round" />
              <circle cx="33" cy="33" r="8" fill="#ffffff" stroke="#2563eb" strokeWidth="1.75" />
              <path d="M33 29.5v7M29.5 33h7" stroke="#2563eb" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </div>
          <h2>No trades logged yet</h2>
          <p>Capture your first entry above to start tracking realised P&amp;L, win rate, and R-multiples.</p>
          <p className="journal-empty-cta">Use the Log trade form to add a symbol.</p>
        </div>
      ) : (
        <div className="journal-log-panel">
          <div className="journal-log-toolbar">
            <div>
              <h2>Trade log</h2>
              <p>Open and closed trades saved on this device</p>
            </div>
            <div className="journal-filters" role="tablist" aria-label="Trade filters">
              {(
                [
                  { id: "all", label: "All" },
                  { id: "open", label: "Open" },
                  { id: "closed", label: "Closed" },
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
          </div>

          {visible.length === 0 ? (
            <p className="journal-filter-empty">No trades match this filter.</p>
          ) : (
            <div className="journal-list">
              {visible.map((trade) => {
                const closed = isClosed(trade);
                const live = market.quotes[trade.symbol]?.lastPrice ?? null;
                const result = closed ? tradeResult(trade) : connected && live != null ? tradeResult(trade, live) : null;
                const isClosing = closing?.id === trade.id;
                const noteExpanded = Boolean(expandedNotes[trade.id]);
                const pnlTone =
                  result == null || result.pnl === 0 ? "" : result.pnl > 0 ? " is-profit" : " is-loss";
                return (
                  <article
                    key={trade.id}
                    className={`journal-row${closed ? " is-closed" : " is-open"}${pnlTone}`}
                  >
                    <div className="journal-main">
                      <div className="journal-identity">
                        <a className="ticker" href={`#/recommendations/${trade.symbol}`}>
                          {trade.symbol}
                        </a>
                        <span className={closed ? "journal-tag is-closed" : "journal-tag is-open"}>
                          {closed ? "Closed" : "Open"}
                        </span>
                        {trade.triggerTier ? (
                          <span className={`journal-tag is-${trade.triggerTier}`}>
                            {trade.triggerTier === "standard" ? "Standard" : "Prime"}
                          </span>
                        ) : null}
                        <time className="journal-date num" dateTime={trade.entryDate}>
                          {trade.entryDate}
                        </time>
                      </div>
                      <p className="journal-company">{namesBySymbol[trade.symbol] ?? trade.symbol}</p>
                      <div className="journal-metrics">
                        <span>
                          <em>Entry</em>
                          <strong className="num">{formatInr(trade.entryPrice)}</strong>
                        </span>
                        <span>
                          <em>Qty</em>
                          <strong className="num">{trade.qty}</strong>
                        </span>
                        <span>
                          <em>Stop</em>
                          <strong className="num">
                            {trade.stopPrice != null ? formatInr(trade.stopPrice) : "—"}
                          </strong>
                        </span>
                        <span>
                          <em>{closed ? "Exit" : "Current"}</em>
                          <strong className="num">
                            {closed
                              ? formatInr(trade.exitPrice ?? 0)
                              : live != null && connected
                                ? formatInr(live)
                                : "—"}
                          </strong>
                        </span>
                      </div>
                      {trade.note ? (
                        <div className={`journal-note-block${noteExpanded ? " is-expanded" : ""}`}>
                          <p className="journal-text">{trade.note}</p>
                          {trade.note.length > 90 ? (
                            <button
                              type="button"
                              className="journal-note-toggle"
                              onClick={() =>
                                setExpandedNotes((current) => ({
                                  ...current,
                                  [trade.id]: !current[trade.id],
                                }))
                              }
                            >
                              {noteExpanded ? "Show less" : "Show more"}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <div className="journal-result">
                      {result ? (
                        <>
                          <strong className={`num ${tone(result.pnl)}`}>{formatSignedInr(result.pnl)}</strong>
                          <span className={`num journal-r ${tone(result.pnl)}`}>
                            {formatPercent(result.pnlPercent)} · {fmtR(result.rMultiple)}
                          </span>
                          {!closed ? <span className="watch-muted">unrealised (live)</span> : null}
                        </>
                      ) : (
                        <span className="watch-muted">{closed ? "—" : "Connect Kite for live P&L"}</span>
                      )}
                    </div>
                    <div className="journal-actions">
                      {isClosing && closing ? (
                        <form className="journal-close" onSubmit={onClose}>
                          <input
                            type="number"
                            step="0.05"
                            min="0"
                            autoFocus
                            aria-label="Exit price"
                            placeholder="Exit price"
                            value={closing.price}
                            onChange={(event) => setClosing({ ...closing, price: event.target.value })}
                          />
                          <input
                            type="date"
                            aria-label="Exit date"
                            value={closing.date}
                            max={today()}
                            onChange={(event) => setClosing({ ...closing, date: event.target.value })}
                          />
                          <button type="submit" className="refresh-button is-selected">
                            Save
                          </button>
                          <button type="button" className="watch-remove" onClick={() => setClosing(null)}>
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <>
                          {!closed ? (
                            <button
                              type="button"
                              className="refresh-button journal-close-btn"
                              onClick={() =>
                                setClosing({ id: trade.id, price: live != null ? String(live) : "", date: today() })
                              }
                            >
                              Close trade
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="watch-remove"
                            onClick={() => commit(trades.filter((item) => item.id !== trade.id))}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function cumulativePnlSeries(trades: readonly JournalTrade[]): number[] {
  const closed = trades
    .filter(isClosed)
    .map((trade) => ({ trade, result: tradeResult(trade) }))
    .filter((item): item is { trade: JournalTrade; result: NonNullable<ReturnType<typeof tradeResult>> } => item.result != null)
    .sort((a, b) => (a.trade.exitDate ?? "").localeCompare(b.trade.exitDate ?? ""));
  let running = 0;
  const points = [0];
  for (const item of closed) {
    running += item.result.pnl;
    points.push(running);
  }
  return points;
}

function JournalSpark({ points, tone }: { points: readonly number[]; tone: "up" | "down" | "flat" }) {
  if (points.length < 2) {
    return (
      <svg className={`journal-spark is-${tone}`} viewBox="0 0 120 40" aria-hidden="true">
        <path
          d="M2 20 L118 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeDasharray="3 4"
          opacity="0.55"
        />
      </svg>
    );
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(max - min, 1e-6);
  const plotted = points.map((point, index) => {
    const x = (index / (points.length - 1)) * 116 + 2;
    const y = 34 - ((point - min) / span) * 26;
    return { x, y };
  });
  const line = plotted.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
  const first = plotted[0];
  const last = plotted[plotted.length - 1];
  const area = `M${first.x.toFixed(2)},38 L${line} L${last.x.toFixed(2)},38 Z`;
  return (
    <svg className={`journal-spark is-${tone}`} viewBox="0 0 120 40" aria-hidden="true">
      <path d={area} fill="currentColor" opacity="0.12" />
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

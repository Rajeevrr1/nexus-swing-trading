import { useMemo } from "react";
import { createPortal } from "react-dom";
import { buildAnalysis } from "../analysis";
import { useAlerts } from "../alerts/AlertsContext";
import type { AlertType, DeskAlert } from "../alerts/types";
import { useMarketData } from "../market/MarketData";
import { evaluateSwingSetup, executionAlertText, prioritize, sectorStrength, triggerBadge, triggerBadgeClass } from "../recommendations/setup";
import { useOpenRiskBook } from "../risk/openBook";
import { useRiskSettings } from "../risk/settings";
import { useRecommendations } from "../scanner/useScanResults";
import { STRATEGY_NOTE } from "../strategy";

const TYPE_LABEL: Record<AlertType, string> = {
  exit: "Exit",
  strong: "Strong Buy",
  book: "Book Profit",
  caution: "Caution",
  prime: "Prime Trigger",
  standard: "Std Trigger",
  review: "Review",
};

const SUMMARY: {
  key: "exit" | "strong" | "book" | "caution";
  label: string;
  text: string;
  tone: "exit" | "prime" | "book" | "caution";
}[] = [
  { key: "exit", label: "Exit", text: "A holding closes below EMA 20.", tone: "exit" },
  {
    key: "strong",
    label: "Strong Buy",
    text: "Grade A+ or A, and a Prime or Standard trigger is active. Grade alone is a rank.",
    tone: "prime",
  },
  {
    key: "book",
    label: "Book Profit",
    text: "A holding reaches +12%, or gives back a gain on a down close after +6%.",
    tone: "book",
  },
  {
    key: "caution",
    label: "Caution",
    text: "A holding is above EMA 20, but it is no longer ahead of Nifty.",
    tone: "caution",
  },
];

export function Alerts() {
  const { alerts, unread, markRead, markAllRead } = useAlerts();
  const market = useMarketData();
  const connected = market.status.connected && !market.needsReconnect;
  const recommendations = useRecommendations();
  const riskSettings = useRiskSettings();
  const openBook = useOpenRiskBook();
  const setups = useMemo(
    () =>
      Object.fromEntries(
        recommendations.map((security) => {
          const bars = market.histories[security.symbol]?.length
            ? market.histories[security.symbol]
            : connected
              ? []
              : buildAnalysis(security).bars;
          return [
            security.symbol,
            evaluateSwingSetup(
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
            ),
          ];
        }),
      ),
    [connected, market.histories, market.niftyBars, market.quotes, openBook, recommendations, riskSettings],
  );
  const desk = prioritize(recommendations, setups).slice(0, 8);
  const typeCounts = useMemo(() => {
    const counts = { exit: 0, strong: 0, book: 0, caution: 0 };
    for (const alert of alerts) {
      if (alert.type === "exit") counts.exit += 1;
      else if (alert.type === "strong") counts.strong += 1;
      else if (alert.type === "book") counts.book += 1;
      else if (alert.type === "caution") counts.caution += 1;
    }
    return counts;
  }, [alerts]);

  return (
    <section className="panel alerts-page" data-page="alerts" aria-labelledby="alerts-heading">
      <div className="panel-head alerts-head">
        <div className="alerts-hero">
          <p className="ov-brand">Live desk</p>
          <h1 id="alerts-heading">Alerts</h1>
          <p className="strategy-note">{STRATEGY_NOTE}</p>
          <p className="lede">
            Exit, book-profit, and caution alerts come from the live Kite book. Today’s prime and continuation triggers
            stay on this desk even when the young-trend gate is quiet.
          </p>
        </div>
        <button type="button" className="refresh-button alerts-mark-all" onClick={markAllRead} disabled={unread === 0}>
          Mark all read
        </button>
      </div>

      <div className="alerts-summary" aria-label="Alert type summary">
        {SUMMARY.map((item) => (
          <article key={item.key} className={`alerts-summary-card is-${item.tone}`}>
            <div className="alerts-summary-top">
              <span className="alerts-summary-label">{item.label}</span>
              <strong className="alerts-summary-count num">{typeCounts[item.key]}</strong>
            </div>
            <p className="alerts-summary-text">{item.text}</p>
          </article>
        ))}
      </div>

      <div className="dash-section alerts-triggers">
        <div className="dash-card-head">
          <h2>Today’s triggers</h2>
        </div>
        {desk.length === 0 ? (
          <p className="dash-empty-note">No graded names on the scan yet.</p>
        ) : (
          <ul className="dash-recs alerts-trigger-list">
            {desk.map((rec) => {
              const setup = setups[rec.symbol];
              const badgeClass = triggerBadgeClass(setup.triggerTier, setup.actionBucket);
              const ticketTone = setup.triggerTier
                ? setup.triggerTier
                : setup.actionBucket === "gtt"
                  ? "gtt"
                  : setup.actionBucket === "near"
                    ? "near"
                    : "watch";
              const copy = setup.triggerTier
                ? executionAlertText({
                    tier: setup.triggerTier,
                    symbol: rec.symbol,
                    sector: rec.sector,
                    setup,
                  })
                : (setup.triggerHint ?? "Watch");
              return (
                <li key={rec.symbol}>
                  <a className={`dash-rec alerts-ticket is-${ticketTone}`} href={`#/recommendations/${rec.symbol}`}>
                    <span className="alerts-ticket-top">
                      <strong className="alerts-symbol">{rec.symbol}</strong>
                      <span className={badgeClass}>{triggerBadge(setup.triggerTier, setup.actionBucket)}</span>
                    </span>
                    <span className={`dash-rec-meta trigger-copy num${ticketTone === "watch" ? " is-watch-copy" : ""}`}>
                      {copy}
                    </span>
                    {ticketTone === "watch" ? (
                      <span className="alerts-watch-meter" aria-hidden="true">
                        <span className="alerts-watch-meter-track">
                          <span className="alerts-watch-meter-fill" />
                        </span>
                        <span className="alerts-watch-meter-label">Awaiting RS / trigger</span>
                      </span>
                    ) : null}
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {alerts.length === 0 ? (
        <div className="book-empty">
          <p>No alerts yet. They appear here when a live holding or a new strong recommendation meets a rule above.</p>
        </div>
      ) : (
        <div className="alert-list">
          {alerts.map((alert) => (
            <article
              key={alert.id}
              className={`alert-row is-${alert.type}${alert.read ? " is-read" : ""}${alert.active ? " is-active" : " is-cleared"}`}
              data-alert={alert.type}
            >
              <div className="alert-row-top">
                <span className="alert-symbol">{alert.symbol}</span>
                <span className={`alert-type tone-${toneFor(alert.type)}`}>{TYPE_LABEL[alert.type]}</span>
                <span className={alert.active ? "source-tag is-live" : "source-tag"}>{alert.active ? "Active" : "Cleared"}</span>
                <time dateTime={alert.createdAt}>{formatAlertTime(alert.createdAt)}</time>
              </div>
              <p className="alert-message num">{alert.message}</p>
              <div className="alert-row-actions">
                <span className="alert-company">{alert.name === alert.symbol ? alert.symbol : alert.name}</span>
                {alert.read ? (
                  <span className="alert-read">Read</span>
                ) : (
                  <button type="button" className="refresh-button alerts-mark-one" onClick={() => markRead(alert.id)}>
                    Mark read
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function AlertToast() {
  const { toast, dismissToast } = useAlerts();
  if (!toast) return null;
  return createPortal(
    <aside className={`alert-toast tone-${toneFor(toast.type)}`} role="status">
      <p className="alert-toast-kicker">
        {TYPE_LABEL[toast.type]} · {toast.symbol}
      </p>
      <p className="alert-toast-body">{toast.message}</p>
      <div className="alert-row-actions">
        <a href="#/alerts" onClick={dismissToast}>
          Open alerts
        </a>
        <button type="button" className="refresh-button" onClick={dismissToast}>
          Dismiss
        </button>
      </div>
    </aside>,
    document.body,
  );
}

function toneFor(type: AlertType): "weak" | "strong" | "watch" {
  if (type === "exit") return "weak";
  if (type === "caution" || type === "standard" || type === "review") return "watch";
  return "strong";
}

function formatAlertTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const clock = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return `${clock} IST`;
}

export type { DeskAlert };

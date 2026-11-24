import { useEffect, useState } from "react";
import {
  readStandardPerformance,
  STANDARD_METRICS_WINDOW,
  STANDARD_PERFORMANCE_EVENT,
  type StandardPerformanceSnapshot,
} from "../monitor/standardPerformance";

function percent(value: number | null): string {
  if (value == null) return "—";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function ratio(value: number | null): string {
  if (value == null) return "—";
  return value.toFixed(2);
}

/** Live Standard book. Reads localStorage and refreshes when a Standard trade is closed. */
export function useStandardPerformance(): StandardPerformanceSnapshot {
  const [snapshot, setSnapshot] = useState<StandardPerformanceSnapshot>(() => readStandardPerformance());
  useEffect(() => {
    const refresh = () => setSnapshot(readStandardPerformance());
    window.addEventListener(STANDARD_PERFORMANCE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(STANDARD_PERFORMANCE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return snapshot;
}

export function StandardPerformanceCard() {
  const { history, metrics, standardPerformanceWarning, warningMessage } = useStandardPerformance();
  const windowLabel =
    history.length > STANDARD_METRICS_WINDOW
      ? `Last ${STANDARD_METRICS_WINDOW} of ${history.length} closed Standard trades`
      : history.length === 1
        ? "Last closed Standard trade"
        : `Last ${metrics.sample} closed Standard trades`;

  return (
    <article className={`std-monitor${standardPerformanceWarning ? " is-warning" : ""}`} aria-live="polite">
      <header className="std-monitor-head">
        <h2>Standard performance</h2>
        <p>{windowLabel}</p>
      </header>
      {standardPerformanceWarning && warningMessage ? (
        <p className="std-monitor-warn" role="status">
          {warningMessage}
        </p>
      ) : null}
      {metrics.sample === 0 ? (
        <p className="std-monitor-empty">
          No closed Standard trades yet. Tag a journal entry as Standard, then close it to start this book. Prime trades
          are not included.
        </p>
      ) : (
        <dl className="std-monitor-metrics">
          <div>
            <dt>Win rate</dt>
            <dd className="num">{metrics.winRate == null ? "—" : `${(metrics.winRate * 100).toFixed(0)}%`}</dd>
          </div>
          <div>
            <dt>Average R</dt>
            <dd className="num">{metrics.avgR == null ? "—" : `${metrics.avgR >= 0 ? "+" : ""}${metrics.avgR.toFixed(2)}R`}</dd>
          </div>
          <div>
            <dt>Expectancy</dt>
            <dd className={`num${metrics.expectancy != null && metrics.expectancy < 0 ? " is-neg" : ""}`}>
              {percent(metrics.expectancy)}
            </dd>
          </div>
          <div>
            <dt>Profit factor</dt>
            <dd className="num">{ratio(metrics.profitFactor)}</dd>
          </div>
        </dl>
      )}
    </article>
  );
}

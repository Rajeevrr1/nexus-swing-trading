import { useMemo, useState } from "react";
import { useMarketData } from "../market/MarketData";
import { formatPercent } from "../portfolio";
import { useScanResults } from "../scanner/useScanResults";
import { buildSectorRows, RETURN_LOOKBACK, trailingReturn } from "../sectors/rotation";

export function Sectors() {
  const market = useMarketData();
  const connected = market.status.connected && !market.needsReconnect;
  const scanned = useScanResults();
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => {
    const returns: Record<string, number | null> = {};
    if (connected) {
      for (const security of scanned) {
        const bars = market.histories[security.symbol];
        returns[security.symbol] = bars?.length ? trailingReturn(bars.map((bar) => bar.close)) : null;
      }
    }
    return buildSectorRows(scanned, returns);
  }, [connected, market.histories, scanned]);

  const hasReturns = rows.some((row) => row.avgReturn != null);
  const leaders = rows.slice(0, 3);
  const laggards = rows.slice(-3).reverse();

  return (
    <section className="panel sectors-page" data-page="sectors" aria-labelledby="sectors-heading">
      <div className="panel-head sectors-head">
        <div className="sectors-hero">
          <p className="ov-brand">NSE swing desk</p>
          <h1 id="sectors-heading">Sector Rotation</h1>
          <p className="lede">
            Sectors ranked by scanner conviction and sector strength
            {hasReturns
              ? `, blended with ${RETURN_LOOKBACK}-day price momentum from live history`
              : ". Connect Kite to add live price momentum"}
            . Favour setups from leading sectors.
          </p>
        </div>
        <p className="count sectors-count">
          <strong className="num">{rows.length}</strong>
          <span>
            sectors
            <br />
            tracked
          </span>
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="book-empty sectors-empty">
          <p>No scanner data yet.</p>
        </div>
      ) : (
        <>
          <div className="sectors-summary" aria-label="Rotation snapshot">
            <article className="sectors-summary-card is-leading">
              <span className="sectors-summary-label">Leading</span>
              <strong>{leaders.map((row) => row.sector).join(" · ")}</strong>
              <p>Highest blended strength and conviction right now.</p>
            </article>
            <article className="sectors-summary-card is-lagging">
              <span className="sectors-summary-label">Lagging</span>
              <strong>{laggards.map((row) => row.sector).join(" · ")}</strong>
              <p>Weakest sectors — avoid unless a name clearly leads its group.</p>
            </article>
          </div>

          <p className="sector-leaders">
            <span className="dash-label">Leading now</span>
            {leaders.map((row, index) => (
              <span key={row.sector} className={`tranche-pill sector-leader-pill is-rank-${index + 1}`}>
                <span className="sector-leader-rank">#{index + 1}</span>
                <span>{row.sector}</span>
                <span className="sector-leader-score num">{row.strength.toFixed(0)}</span>
              </span>
            ))}
          </p>

          <div className="sector-list">
            {rows.map((row) => {
              const isOpen = open === row.sector;
              const tone = row.strength >= 62 ? "strong" : row.strength >= 50 ? "watch" : "weak";
              const momentum =
                row.avgReturn == null ? "flat" : row.avgReturn > 0 ? "up" : row.avgReturn < 0 ? "down" : "flat";
              return (
                <article key={row.sector} className={`sector-row is-${tone}${isOpen ? " is-open" : ""}`}>
                  <button
                    type="button"
                    className="sector-head"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : row.sector)}
                  >
                    <span className="sector-rank num">#{row.rank}</span>
                    <span className="sector-name">
                      <strong>{row.sector}</strong>
                      <span>
                        {row.count} stocks · {row.recommendations} recommended
                      </span>
                    </span>

                    <span className="sector-strength-block">
                      <span className="sector-bar" aria-hidden="true">
                        <span className={`tone-fill-${tone}`} style={{ width: `${Math.round(row.strength)}%` }} />
                      </span>
                      <SectorMomentum tone={momentum} />
                    </span>

                    <span className="sector-metrics">
                      <span className="sector-metric">
                        <span className="dash-label">Strength</span>
                        <strong className={`num tone-text-${tone}`}>{row.strength.toFixed(0)}</strong>
                      </span>
                      <span className="sector-metric">
                        <span className="dash-label">Avg conviction</span>
                        <strong className="num">{row.avgConviction.toFixed(0)}</strong>
                      </span>
                      <span className="sector-metric">
                        <span className="dash-label">{RETURN_LOOKBACK}d return</span>
                        <strong
                          className={`num ${
                            row.avgReturn == null
                              ? "watch-muted"
                              : row.avgReturn >= 0
                                ? "tone-text-strong"
                                : "tone-text-weak"
                          }`}
                        >
                          {row.avgReturn == null ? "—" : formatPercent(row.avgReturn)}
                        </strong>
                      </span>
                      <span className="sector-metric">
                        <span className="dash-label">Breadth</span>
                        <strong className="num">{row.breadth == null ? "—" : `${Math.round(row.breadth * 100)}%`}</strong>
                      </span>
                    </span>

                    <span className="sector-expand">
                      <span className="sector-expand-label">{isOpen ? "Hide stocks" : "View stocks"}</span>
                      <span className="sector-expand-chevron" aria-hidden="true">
                        {isOpen ? "▾" : "▸"}
                      </span>
                    </span>
                  </button>

                  {isOpen ? (
                    <ul className="sector-members">
                      {row.members.map((member) => (
                        <li key={member.symbol}>
                          <a href={`#/recommendations/${member.symbol}`}>
                            <strong className="num">{member.symbol}</strong>
                            <span>{member.name}</span>
                          </a>
                          <span className="num">{member.conviction}</span>
                          {member.grade ? (
                            <span className="grade-letter">{member.grade}</span>
                          ) : (
                            <span className="watch-muted">—</span>
                          )}
                          <span
                            className={
                              member.ret == null
                                ? "watch-muted"
                                : member.ret >= 0
                                  ? "tone-text-strong"
                                  : "tone-text-weak"
                            }
                          >
                            {member.ret == null ? "—" : formatPercent(member.ret)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function SectorMomentum({ tone }: { tone: "up" | "down" | "flat" }) {
  const line =
    tone === "up"
      ? "M1 10 L4 8 L7 9 L10 5 L13 6 L16 3 L19 4 L22 2"
      : tone === "down"
        ? "M1 2 L4 4 L7 3 L10 7 L13 6 L16 9 L19 8 L22 10"
        : "M1 6 L4 7 L7 5 L10 6 L13 7 L16 6 L19 7 L22 6";
  return (
    <svg className={`sector-momentum is-${tone}`} viewBox="0 0 24 12" aria-hidden="true">
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

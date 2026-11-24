import { useEffect, useRef, useState } from "react";
import { analyzeBars, buildAnalysis, formatInr } from "../analysis";
import { useMarketData } from "../market/MarketData";
import { buildDecisionSupport } from "../recommendations/decision";
import { evaluateSwingSetup, sectorStrength, triggerBadge, triggerBadgeClass } from "../recommendations/setup";
import { useOpenRiskBook } from "../risk/openBook";
import { useRiskSettings } from "../risk/settings";
import { CopyPrice } from "./CopyPrice";
import { DecisionPanel } from "./DecisionPanel";
import { STRATEGY_NOTE } from "../strategy";
import { toneForScore, type FactorKey, type ScoredSecurity } from "../scanner";
import { CandleChart, type ChartOverlays } from "./CandleChart";
import { Gauge } from "./Gauge";
import { IconBack } from "./icons";

const BREAKDOWN_LABELS: Record<FactorKey, string> = {
  trueRs: "True RS",
  volume: "Volume",
  sector: "Sector Strength",
  closingStrength: "Closing Strength",
};

function relation(close: number, level: number): string {
  if (close >= level) return "Close above";
  return "Close below";
}

export function StockDetail({
  security,
  symbol,
  onBack,
}: {
  security: ScoredSecurity | null;
  symbol: string;
  onBack: () => void;
}) {
  const market = useMarketData();
  const openBook = useOpenRiskBook();
  const riskSettings = useRiskSettings();
  const chartRef = useRef<HTMLElement>(null);
  const [pinned, setPinned] = useState(false);
  const [overlays, setOverlays] = useState<ChartOverlays>({
    ema: true,
    levels: true,
    macd: true,
    tradeLevels: true,
  });

  if (!security) {
    return (
      <section className="panel detail-page" data-page="detail" data-symbol={symbol}>
        <button type="button" className="back-link" onClick={onBack}>
          <IconBack />
          Recommendations
        </button>
        <h1>Not in this scan</h1>
        <p className="lede">{symbol} is not in the Nifty 100 universe.</p>
      </section>
    );
  }

  const connected = market.status.connected && !market.needsReconnect;
  const liveBars = market.histories[security.symbol];
  const liveAnalysis =
    liveBars && liveBars.length >= 50
      ? analyzeBars(security.symbol, liveBars, "Daily candles from Kite.")
      : null;
  const analysis = liveAnalysis ?? (connected ? null : buildAnalysis(security));
  const livePrice = market.quotes[security.symbol]?.lastPrice;
  const displayClose = livePrice ?? analysis?.lastClose ?? null;
  const priceIsLive = livePrice != null;
  const setup = evaluateSwingSetup(
    liveBars ?? (connected ? [] : buildAnalysis(security).bars),
    market.niftyBars,
    sectorStrength(security),
    riskSettings,
    {
      openRiskRupees: openBook.openRiskRupees,
      openSectors: openBook.openSectors,
      sector: security.sector,
      livePrice: livePrice ?? null,
    },
  );
  const action = setup.action ?? security.action;

  useEffect(() => {
    const node = chartRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const scrolledPast = entry.boundingClientRect.bottom < 72;
        setPinned(!entry.isIntersecting && scrolledPast);
      },
      { threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [analysis]);
  const decision =
    setup.closeStrength != null && setup.lowDistance != null
      ? buildDecisionSupport(setup, setup.closeStrength, setup.lowDistance)
      : buildDecisionSupport(setup, 0.5, 0.03);

  return (
    <section className="panel detail-page" data-page="detail" data-symbol={security.symbol} aria-labelledby="detail-heading">
      <button type="button" className="back-link" onClick={onBack}>
        <IconBack />
        Recommendations
      </button>

      {pinned ? (
        <div className="exec-sticky" role="region" aria-label="Execution summary">
          <strong className="exec-sticky-symbol">{security.symbol}</strong>
          <span>
            Entry <b className="num">{setup.entryPrice == null ? "—" : formatInr(setup.entryPrice)}</b>
          </span>
          <span>
            {setup.triggerTier ? "Max buy" : "GTT"}{" "}
            <b className="num">
              {setup.triggerTier
                ? setup.maxChasePrice == null
                  ? "—"
                  : formatInr(setup.maxChasePrice)
                : setup.buyZoneTop == null
                  ? "—"
                  : formatInr(setup.buyZoneTop)}
            </b>
          </span>
          <span>
            SL <b className="num">{setup.initialStopLoss == null ? "—" : formatInr(setup.initialStopLoss)}</b>
          </span>
          <span>
            Qty <b className="num">{setup.suggestedQty ?? "—"}</b>
          </span>
          <span>
            R <b className="num">{setup.riskRewardTo12Pct == null ? "—" : `${setup.riskRewardTo12Pct.toFixed(2)}R`}</b>
          </span>
        </div>
      ) : null}

      <div className="detail-top">
        <div className="detail-hero">
          <p className="ov-brand">NSE swing analysis</p>
          <h1 id="detail-heading">{security.symbol}</h1>
          <p className="strategy-note">{STRATEGY_NOTE}</p>
          <p className="detail-name">
            {security.name}
            <span>{security.sector}</span>
          </p>
          <p className="detail-close">
            <span className="detail-close-label">{priceIsLive ? "Live price" : connected ? "Live price" : "Sample close"}</span>
            <strong className="num">{displayClose == null ? "No Kite quote" : formatInr(displayClose)}</strong>
          </p>
          <p className="lede detail-lede">
            {liveAnalysis
              ? liveAnalysis.disclaimer
              : connected
                ? market.loading
                  ? "Loading daily candles from Kite."
                  : "Kite did not return daily candles for this symbol."
                : "Sample daily candles. Kite is not connected."}
          </p>
        </div>
        <div className="detail-score">
          <Gauge score={security.conviction} />
          <div className={`grade tone-${security.tone}`}>
            <span className="grade-letter">{security.grade ?? "—"}</span>
            <span className="grade-stance">{security.stance}</span>
          </div>
        </div>
      </div>

      <article className="chart-card chart-card-primary" ref={chartRef}>
        <header className="chart-card-head">
          <h2>Price</h2>
          <p>Daily candles. Toggle EMA, support and resistance, or the MACD pane.</p>
        </header>
        <div className="chart-toggles" role="group" aria-label="Chart overlays">
          <ChartToggle label="EMA 20 / 50" pressed={overlays.ema} onClick={() => setOverlays((current) => ({ ...current, ema: !current.ema }))} />
          <ChartToggle
            label="Trade Levels"
            pressed={overlays.tradeLevels ?? true}
            onClick={() => setOverlays((current) => ({ ...current, tradeLevels: !(current.tradeLevels ?? true) }))}
          />
          <ChartToggle
            label="Support / Resistance"
            pressed={overlays.levels}
            onClick={() => setOverlays((current) => ({ ...current, levels: !current.levels }))}
          />
          <ChartToggle label="MACD" pressed={overlays.macd} onClick={() => setOverlays((current) => ({ ...current, macd: !current.macd }))} />
        </div>
        {analysis ? (
          <CandleChart
            analysis={analysis}
            overlays={overlays}
            tradeLevels={{
              entry: setup.entryPrice,
              maxChase: setup.maxChasePrice,
              stop: setup.initialStopLoss,
              tranche1: setup.entryPrice ? Number((setup.entryPrice * 1.06).toFixed(2)) : null,
              target: setup.targetPrice,
            }}
          />
        ) : (
          <p className="feed-note">
            {market.loading ? "Loading daily candles from Kite." : "Kite did not return daily candles for this symbol."}
          </p>
        )}
        {analysis && displayClose != null ? (
          <dl className="indicator-row">
            {overlays.ema ? (
              <>
                <div>
                  <dt>EMA 20</dt>
                  <dd>{formatInr(analysis.ema20Last)}</dd>
                  <p>{relation(displayClose, analysis.ema20Last)}</p>
                </div>
                <div>
                  <dt>EMA 50</dt>
                  <dd>{formatInr(analysis.ema50Last)}</dd>
                  <p>{relation(displayClose, analysis.ema50Last)}</p>
                </div>
              </>
            ) : null}
            {overlays.levels ? (
              <>
                <div>
                  <dt>Support</dt>
                  <dd>{formatInr(analysis.support)}</dd>
                  <p>Recent swing low</p>
                </div>
                <div>
                  <dt>Resistance</dt>
                  <dd>{formatInr(analysis.resistance)}</dd>
                  <p>Recent swing high</p>
                </div>
              </>
            ) : null}
            {overlays.macd ? (
              <div>
                <dt>MACD</dt>
                <dd>{analysis.macdLast.toFixed(2)}</dd>
                <p>
                  Signal {analysis.signalLast.toFixed(2)} · Hist{" "}
                  <span className={analysis.histogramLast >= 0 ? "tone-text-strong" : "tone-text-weak"}>
                    {analysis.histogramLast.toFixed(2)}
                  </span>
                </p>
              </div>
            ) : null}
          </dl>
        ) : null}
      </article>

      <DecisionPanel decision={decision} />

      <div className="detail-grid">
        <article className="chart-card score-breakdown">
          <header className="chart-card-head">
            <h2>Score breakdown</h2>
            <p>
              Conviction <span className="num">{security.conviction}</span> from the NSE scanner.
            </p>
          </header>
          <ul className="factors">
            {security.factors.map((factor) => {
              const tone = toneForScore(factor.value);
              return (
                <li key={factor.key}>
                  <div className="factor-top">
                    <span>{BREAKDOWN_LABELS[factor.key]}</span>
                    <span className={`factor-value num tone-text-${tone}`}>{factor.value}</span>
                  </div>
                  <div className="bar" aria-hidden="true">
                    <span className={`bar-fill tone-fill-${tone}`} style={{ width: `${factor.value}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </article>

        <article className={`chart-card action-card tone-line-${security.tone}`}>
          <header className="chart-card-head">
            <h2>Suggested swing action</h2>
            <p className={`action-stance tone-text-${security.tone}`}>
              <span className="action-stance-label">{security.stance}</span>
              {security.grade ? <span className="action-stance-grade">· {security.grade}</span> : null}
            </p>
          </header>
          <div className="setup-meta">
            <p className={triggerBadgeClass(setup.triggerTier, setup.actionBucket)}>
              {triggerBadge(setup.triggerTier, setup.actionBucket)}
            </p>
            {setup.quality != null ? (
              <p className="quality-tag">
                Quality <span className="num">{setup.quality}</span>
                {setup.confidence ? ` · ${setup.confidence}` : ""}
              </p>
            ) : null}
            <p className="tape-meta">
              EMA spread{" "}
              <span className="num">
                {setup.emaSpreadPct == null ? "—" : `${setup.emaSpreadPct.toFixed(1)}%`}
              </span>{" "}
              · RVOL <span className="num">{setup.rvol == null ? "—" : setup.rvol.toFixed(2)}</span>
            </p>
          </div>
          {setup.triggerHint ? <p className="trigger-hint">{setup.triggerHint}</p> : null}
          <div className="copy-row">
            <CopyPrice label="Entry" value={setup.entryPrice} variant="entry" />
            {setup.triggerTier ? <CopyPrice label="Max buy" value={setup.maxChasePrice} variant="max-buy" /> : null}
            {!setup.triggerTier ? <CopyPrice label="GTT limit" value={setup.buyZoneTop} variant="gtt" /> : null}
            <CopyPrice label="T1 +6% (50%)" value={setup.t1TargetPrice} variant="target" />
          </div>
          {setup.initialStopLoss != null && setup.suggestedQty != null ? (
            <div className="risk-hint">
              {setup.triggerTier && setup.riskRewardTo12Pct != null ? (
                <p>
                  <span className="action-kicker">Reward</span>
                  <span className="num">{setup.riskRewardTo12Pct.toFixed(2)}R</span>
                </p>
              ) : null}
              <p>
                <span className="action-kicker">Stop loss (ATR)</span>
                <span className="num">{formatInr(setup.initialStopLoss)}</span>
              </p>
              <p>
                <span className="action-kicker">{setup.triggerTier === "standard" ? "Suggested qty (0.5x)" : "Suggested qty"}</span>
                <span className="num">
                  {setup.suggestedQty} shares · {formatInr(setup.capitalUsed ?? 0)}
                </span>
              </p>
            </div>
          ) : null}
          <p className="action-copy">{action}</p>
        </article>
      </div>
    </section>
  );
}

function ChartToggle({ label, pressed, onClick }: { label: string; pressed: boolean; onClick: () => void }) {
  return (
    <button type="button" className={pressed ? "chart-toggle is-on" : "chart-toggle"} aria-pressed={pressed} onClick={onClick}>
      {label}
    </button>
  );
}

import { buildAnalysis, formatInr } from "../analysis";
import { useMarketData } from "../market/MarketData";
import { buildDecisionSupport } from "../recommendations/decision";
import { triggerBadge, triggerBadgeClass, type SwingSetup } from "../recommendations/setup";
import { CompactLevels } from "./CompactLevels";
import { toneForScore, type Recommendation } from "../scanner";

export function RecommendationCard({
  recommendation,
  setup,
  selected,
  deskPick = false,
  inPortfolio = false,
  sectorCount = 0,
  openSlots = 5,
  maxSlots = 5,
  isWatched = false,
  onToggleWatch,
  onOpen,
}: {
  recommendation: Recommendation;
  setup?: SwingSetup;
  selected: boolean;
  deskPick?: boolean;
  inPortfolio?: boolean;
  sectorCount?: number;
  openSlots?: number;
  maxSlots?: number;
  isWatched?: boolean;
  onToggleWatch?: (symbol: string) => void;
  onOpen: (symbol: string) => void;
}) {
  const { symbol, name, sector, conviction, grade, stance, tone, factors, action } = recommendation;
  const market = useMarketData();
  const live = market.quotes[symbol];
  const connected = market.status.connected && !market.needsReconnect;
  const price = live?.lastPrice ?? (connected ? null : buildAnalysis(recommendation).lastClose);
  const decision =
    setup?.pullbackSwing && setup.closeStrength != null && setup.lowDistance != null
      ? buildDecisionSupport(setup, setup.closeStrength, setup.lowDistance)
      : null;

  const riskLabel =
    setup?.triggerTier === "prime" ? "Full" : setup?.triggerTier === "standard" ? "Half" : "Watch";

  const guard =
    inPortfolio
      ? { text: "In portfolio", kind: "held" as const }
      : openSlots <= 0
        ? { text: maxSlots === 0 ? "Regime blocked" : "Slots full", kind: "capped" as const }
        : sectorCount >= 2
          ? { text: `Sector full (${sectorCount}/2)`, kind: "capped" as const }
          : setup?.triggerTier || setup?.actionBucket === "gtt"
            ? { text: "Slot open", kind: "open" as const }
            : null;

  const tierClass =
    setup?.triggerTier === "prime"
      ? "is-prime"
      : setup?.triggerTier === "standard"
        ? "is-std"
        : setup?.actionBucket === "gtt"
          ? "is-gtt"
          : "is-watch";

  const actionText = setup?.action ?? action;
  const showHint = Boolean(setup?.triggerHint && setup.triggerHint !== actionText);
  const showSize = setup?.triggerTier != null && setup.suggestedQty != null;
  const showExec =
    setup != null &&
    (setup.triggerTier != null ||
      setup.actionBucket === "gtt" ||
      setup.entryPrice != null ||
      setup.buyZoneTop != null);

  return (
    <article
      tabIndex={0}
      className={["rcard", tierClass, selected ? "is-selected" : ""].filter(Boolean).join(" ")}
      data-symbol={symbol}
      aria-pressed={selected}
      aria-label={`${symbol}, ${name}. Conviction ${conviction}, grade ${grade}. Open details.`}
      onClick={() => onOpen(symbol)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(symbol);
        }
      }}
    >
      <div className="rcard-accent" aria-hidden="true" />

      <header className="rcard-head">
        <div className="rcard-id">
          <div className="rcard-title-row">
            <span className="rcard-ticker">{symbol}</span>
            {deskPick ? <span className="rcard-desk">Desk pick</span> : null}
            {onToggleWatch ? (
              <button
                type="button"
                className={`rcard-watch ${isWatched ? "is-on" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleWatch(symbol);
                }}
                aria-pressed={isWatched}
                title={isWatched ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`}
              >
                {isWatched ? "★" : "☆"}
              </button>
            ) : null}
          </div>
          <p className="rcard-name">{name}</p>
          <p className="rcard-sector">
            <span>{sector}</span>
            {grade ? <span className="rcard-meta-dot">·</span> : null}
            {grade ? <span className="rcard-meta-grade">{grade}</span> : null}
            {stance ? <span className="rcard-meta-dot">·</span> : null}
            {stance ? <span className="rcard-meta-stance">{stance}</span> : null}
          </p>
        </div>
        <div className="rcard-aside">
          <span className="rcard-price num">{price == null ? "—" : formatInr(price)}</span>
          <span className={`rcard-src ${live ? "is-live" : price == null ? "is-miss" : ""}`}>
            {live ? "Live" : price == null ? "No quote" : "Sample"}
          </span>
          <div className={`rcard-grade tone-${tone}`}>
            <span className="rcard-grade-letter">{grade}</span>
            <span className="rcard-conv num">{conviction}</span>
          </div>
        </div>
      </header>

      <div className="rcard-tags">
        {setup ? (
          <span className={triggerBadgeClass(setup.triggerTier, setup.actionBucket)}>
            {triggerBadge(setup.triggerTier, setup.actionBucket)}
          </span>
        ) : null}
        {guard ? <span className={`rcard-guard is-${guard.kind}`}>{guard.text}</span> : null}
      </div>

      {setup ? (
        <div className="rcard-stats" aria-label="Setup metrics">
          <div>
            <span>Quality</span>
            <strong className="num">{setup.quality ?? "—"}</strong>
          </div>
          <div>
            <span>EMA</span>
            <strong className="num">{setup.emaSpreadPct == null ? "—" : `${setup.emaSpreadPct.toFixed(1)}%`}</strong>
          </div>
          <div>
            <span>RVOL</span>
            <strong className="num">{setup.rvol == null ? "—" : setup.rvol.toFixed(2)}</strong>
          </div>
          <div>
            <span>Risk</span>
            <strong>{riskLabel}</strong>
          </div>
        </div>
      ) : null}

      {decision ? (
        <div className={`rcard-verdict is-${decision.verdictTone}`}>
          <span>{decision.verdict}</span>
          <span>{decision.readiness}</span>
        </div>
      ) : null}

      {showExec && setup ? (
        <div
          className="rcard-exec"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <CompactLevels symbol={symbol} setup={setup} />
        </div>
      ) : null}

      <ul className="rcard-factors">
        {factors.map((factor) => {
          const factorTone = toneForScore(factor.value);
          return (
            <li key={factor.key}>
              <div className="rcard-factor-top">
                <span>{factor.label}</span>
                <span className={`tone-text-${factorTone} num`}>{factor.value}</span>
              </div>
              <div className="rcard-bar" aria-hidden="true">
                <span className={`rcard-bar-fill tone-fill-${factorTone}`} style={{ width: `${factor.value}%` }} />
              </div>
            </li>
          );
        })}
      </ul>

      {showHint ? <p className="rcard-hint">{setup!.triggerHint}</p> : null}

      <footer className="rcard-foot">
        <span className="rcard-foot-meta num">
          {showSize && setup
            ? [
                `Qty ${setup.suggestedQty}`,
                formatInr(setup.capitalUsed ?? setup.suggestedQty! * (setup.entryPrice ?? 0)),
                setup.triggerTier && setup.riskRewardTo12Pct != null
                  ? `R ${setup.riskRewardTo12Pct.toFixed(2)}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : actionText}
        </span>
        <button type="button" className="rcard-foot-link" onClick={() => onOpen(symbol)}>
          Open details →
        </button>
      </footer>
    </article>
  );
}

import type { DecisionSupport } from "../recommendations/decision";
import { DecisionPills } from "./DecisionPills";

export function DecisionPanel({ decision }: { decision: DecisionSupport }) {
  return (
    <article
      className={`chart-card decision-panel is-${decision.verdictTone}`}
      data-verdict={decision.verdict}
    >
      <header className="chart-card-head">
        <h2>Decision panel</h2>
        <p>Guidance only. You choose whether and how much to trade.</p>
      </header>
      <div className={`decision-guidance is-${decision.verdictTone}`}>
        <p className="decision-kicker">Qualitative guidance</p>
        <p className={`decision-verdict tone-text-${decision.verdictTone}`}>{decision.verdict}</p>
        <p className="decision-summary">{decision.summary}</p>
      </div>
      <div className="decision-meters">
        <p className="decision-kicker">Score meters</p>
        <DecisionPills
          items={[
            { label: "Chart quality", value: decision.chartQuality.label, tone: decision.chartQuality.tone },
            { label: "Market", value: decision.marketCondition.label, tone: decision.marketCondition.tone },
            { label: "Risk", value: decision.riskLevel.label, tone: decision.riskLevel.tone },
          ]}
        />
      </div>
      <dl className="decision-details">
        <div>
          <dt>Chart quality</dt>
          <dd>{decision.chartQuality.detail}</dd>
        </div>
        <div>
          <dt>Market condition</dt>
          <dd>{decision.marketCondition.detail}</dd>
        </div>
        <div>
          <dt>Risk level</dt>
          <dd>{decision.riskLevel.detail}</dd>
        </div>
        <div>
          <dt>Quality score</dt>
          <dd>{decision.qualityFactor.detail}</dd>
        </div>
      </dl>
    </article>
  );
}

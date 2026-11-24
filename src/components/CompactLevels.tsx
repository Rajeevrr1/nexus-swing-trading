import { useState } from "react";
import { formatInr } from "../analysis";
import type { SwingSetup } from "../recommendations/setup";
import { CopyTradeButton } from "./CopyTradeButton";

type Tone = "entry" | "buy" | "sl" | "target";

function Level({ label, value, tone }: { label: string; value: number | null; tone: Tone }) {
  const [copied, setCopied] = useState(false);
  const empty = value == null || !Number.isFinite(value);
  return (
    <button
      type="button"
      className={`clevel is-${tone}${copied ? " is-copied" : ""}${empty ? " is-empty" : ""}`}
      disabled={empty}
      title={empty ? label : `Copy ${label} ${value!.toFixed(2)}`}
      onClick={(event) => {
        event.stopPropagation();
        if (empty) return;
        void navigator.clipboard.writeText(value!.toFixed(2)).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          },
          () => setCopied(false),
        );
      }}
    >
      <span className="clevel-label">{copied ? "Copied" : label}</span>
      <strong className="clevel-value num">{empty ? "—" : formatInr(value!)}</strong>
    </button>
  );
}

function RiskRewardBar({ setup }: { setup: SwingSetup }) {
  const entry = setup.entryPrice;
  const stop = setup.initialStopLoss;
  const target = setup.targetPrice;
  if (entry == null || stop == null || target == null || entry <= stop || target <= entry) return null;
  const risk = entry - stop;
  const reward = target - entry;
  const total = risk + reward;
  if (total <= 0) return null;
  const riskPct = (risk / total) * 100;
  const rewardPct = (reward / total) * 100;
  const rr = setup.riskRewardTo12Pct ?? reward / risk;
  return (
    <div className="rr-bar" aria-label={`Risk reward ${rr.toFixed(2)}R`}>
      <div className="rr-bar-track">
        <span className="rr-bar-risk" style={{ width: `${riskPct}%` }} />
        <span className="rr-bar-mid" aria-hidden="true" />
        <span className="rr-bar-reward" style={{ width: `${rewardPct}%` }} />
      </div>
      <div className="rr-bar-meta">
        <span className="is-risk">Risk</span>
        <span className="num">R {rr.toFixed(2)}</span>
        <span className="is-reward">Reward</span>
      </div>
    </div>
  );
}

export function CompactLevels({
  symbol,
  setup,
  showCopy = true,
  showRiskReward = false,
}: {
  symbol: string;
  setup: SwingSetup;
  showCopy?: boolean;
  showRiskReward?: boolean;
}) {
  const isTrigger = setup.triggerTier != null;
  const copyable = showCopy && (isTrigger || setup.actionBucket === "gtt");
  return (
    <div className="clevels">
      <div className="clevels-head">
        <span>Levels</span>
        {copyable ? <CopyTradeButton symbol={symbol} setup={setup} /> : null}
      </div>
      <div className="clevels-grid" role="group" aria-label="Execution levels">
        <Level label="Entry" value={setup.entryPrice} tone="entry" />
        {isTrigger ? (
          <Level label="Max buy" value={setup.maxChasePrice} tone="buy" />
        ) : (
          <Level label="GTT" value={setup.buyZoneTop} tone="buy" />
        )}
        <Level label="Stop" value={setup.initialStopLoss} tone="sl" />
        <Level label="T1 +6%" value={setup.t1TargetPrice} tone="target" />
      </div>
      {showRiskReward ? <RiskRewardBar setup={setup} /> : null}
    </div>
  );
}

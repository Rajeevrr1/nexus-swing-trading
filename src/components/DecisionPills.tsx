import type { ReactNode } from "react";
import type { Tone } from "../scanner";

export function DecisionPills({
  items,
}: {
  items: readonly { label: string; value: string; tone: Tone }[];
}) {
  return (
    <ul className="decision-pills" aria-label="Decision factors">
      {items.map((item) => (
        <li key={item.label} className={`decision-pill tone-pill-${item.tone}`}>
          <span className="decision-pill-label">{item.label}</span>
          <strong>{item.value}</strong>
        </li>
      ))}
    </ul>
  );
}

export function DecisionReadiness({
  readiness,
  tone,
  suggestion,
  children,
}: {
  readiness: string;
  tone: Tone;
  suggestion: string;
  children?: ReactNode;
}) {
  return (
    <div className="decision-readiness">
      <span className="decision-kicker">Decision readiness</span>
      <p className={`decision-readiness-label tone-text-${tone}`}>{readiness}</p>
      <p className="decision-readiness-hint">{suggestion}</p>
      {children}
    </div>
  );
}


import {
  GRADE_A_FLOOR,
  RECOMMENDATION_FLOOR,
  toneForScore,
  type Tone,
} from "../scanner";

const CX = 100;
const CY = 108;
const RADIUS = 74;

function point(score: number, radius = RADIUS): { x: number; y: number } {
  const theta = Math.PI * (1 - score / 100);
  return {
    x: CX + radius * Math.cos(theta),
    y: CY - radius * Math.sin(theta),
  };
}

/** Upper semicircle. Sweep 0 travels west → north → east. */
function arc(from: number, to: number): string {
  const start = point(from);
  const end = point(to);
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${RADIUS} ${RADIUS} 0 0 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

const ZONES: readonly { from: number; to: number; tone: Tone }[] = [
  { from: 0, to: RECOMMENDATION_FLOOR - 0.8, tone: "weak" },
  { from: RECOMMENDATION_FLOOR + 0.8, to: GRADE_A_FLOOR - 0.8, tone: "watch" },
  { from: GRADE_A_FLOOR + 0.8, to: 100, tone: "strong" },
];

export function Gauge({ score }: { score: number }) {
  const tone = toneForScore(score);
  const tip = point(score, RADIUS - 16);
  const tail = point(score, 8);
  const left = point(0, RADIUS);
  const right = point(100, RADIUS);

  return (
    <div
      className="gauge"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={score}
      aria-valuetext={`${score} out of 100, ${tone}`}
      aria-label="Conviction score"
    >
      <svg viewBox="0 0 200 132" className="gauge-svg" aria-hidden="true">
        <path d={arc(0, 100)} className="gauge-track" strokeLinecap="round" />
        {ZONES.map((zone) => (
          <path
            key={zone.tone}
            d={arc(zone.from, zone.to)}
            className={`gauge-zone tone-stroke-${zone.tone} ${zone.tone === tone ? "is-active" : "is-quiet"}`}
            strokeLinecap="round"
          />
        ))}
        <line
          x1={tail.x}
          y1={tail.y}
          x2={tip.x}
          y2={tip.y}
          className={`gauge-needle tone-stroke-${tone}`}
        />
        <circle cx={CX} cy={CY} r="5.5" className={`gauge-hub tone-fill-${tone}`} />
        <text x={CX} y={CY - 38} textAnchor="middle" className={`gauge-score tone-fill-${tone}`}>
          {score}
        </text>
        <text x={CX} y={CY - 18} textAnchor="middle" className="gauge-caption">
          Conviction
        </text>
        <text x={left.x} y={CY + 16} textAnchor="middle" className="gauge-tick">
          0
        </text>
        <text x={right.x} y={CY + 16} textAnchor="middle" className="gauge-tick">
          100
        </text>
      </svg>
    </div>
  );
}

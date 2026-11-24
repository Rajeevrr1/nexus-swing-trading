import type { PriceBar } from "../analysis";
import { rsVersusNifty } from "../recommendations/setup";
import { stanceForScore, type Stance } from "../scanner";
import {
  evaluatePositionSignal,
  GOOD_PROFIT,
  type PositionSignal,
  type SignalId,
} from "../strategy/policy";

export { GOOD_PROFIT };
export type { PositionSignal, SignalId };

/**
 * Live exit badge shared by Portfolio and Alerts.
 * Delegates thresholds to strategy/policy. Live hard stop is close-only.
 * Target and the filtered +6% give-back are full-exit signals, not partials.
 */
export function positionSignal(input: {
  lastClose: number;
  ema20: number | null;
  trueRs: number | null;
  entry: number;
  bars?: readonly PriceBar[];
  niftyBars?: readonly PriceBar[];
  initialStopLoss?: number | null;
  entryDate?: string | null;
  t1Booked?: boolean;
}): PositionSignal {
  return evaluatePositionSignal({
    lastClose: input.lastClose,
    ema20: input.ema20,
    entry: input.entry,
    bars: input.bars,
    initialStopLoss: input.initialStopLoss,
    entryDate: input.entryDate,
    t1Booked: input.t1Booked,
    rsWeak: relativeStrengthFaded(input.bars, input.niftyBars, input.trueRs),
  });
}

function relativeStrengthFaded(
  bars: readonly PriceBar[] | undefined,
  nifty: readonly PriceBar[] | undefined,
  trueRs: number | null,
): boolean {
  if (bars && bars.length >= 21 && nifty && nifty.length >= 21) {
    const edge = rsVersusNifty(bars, nifty);
    if (edge != null) return edge < 0;
  }
  const stance: Stance | null = trueRs == null ? null : stanceForScore(trueRs);
  return stance != null && stance !== "Strong";
}

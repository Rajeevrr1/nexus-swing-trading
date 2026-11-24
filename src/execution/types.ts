import type { TriggerTier } from "../strategy/pullback";

/**
 * Future algo order contract. Not wired to Kite place-order yet.
 * Emit only from LIVE mode after the shared policy clears the setup.
 */
export interface DeskOrderIntent {
  symbol: string;
  tier: TriggerTier;
  side: "BUY";
  qty: number;
  limitPrice: number;
  stopLoss: number;
  target: number;
  validForSession: string;
  riskScale: number;
}

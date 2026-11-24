/** Live desk: Prime-only young-trend triggers, 50/50 tranche exit (T1 +6%, T2 EMA 20), and dead-money time stop. */
export const STRATEGY_NOTE = "Strategy v1.4 - Prime-Only Pullback + 50/50 Tranche Trail";

export {
  ALLOW_STANDARD_DESK_ENTRIES,
  allowNewEntry,
  DEAD_MONEY_GAIN_MIN,
  evaluateBarExit,
  evaluatePositionSignal,
  evaluateTrancheBarStep,
  evaluateTranchePlan,
  freezeEntryStop,
  FULL_PROFIT,
  GOOD_PROFIT,
  isDeadMoneyTimeExit,
  maxSlotsForRegime,
  MAX_DESK_SLOTS,
  MAX_PER_SECTOR,
  POSITION_WEIGHT,
  PROTECT_GAIN,
  ratchetStop,
  riskScaleForRegime,
  runnerStopLevel,
  TRANCHE_T1_FRACTION,
  TRANCHE_T1_GAIN,
} from "./strategy/policy";
export type { ExitDecision, PositionSignal, SignalId, TrancheBarStep, TrancheDecision } from "./strategy/policy";

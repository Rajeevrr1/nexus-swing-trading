import type { LiveBookRow } from "../portfolio/liveBook";
import { isStrongGrade, type ScoredSecurity } from "../scanner";
import type { TriggerTier } from "../strategy/pullback";
import { formatInr } from "../analysis";
import { formatPercent } from "../portfolio";
import { executionAlertText, type SwingSetup } from "../recommendations/setup";
import { HOLD_REVIEW_MESSAGE, MAX_HOLD_SESSIONS } from "../strategy/policy";
import type { AlertMemory, AlertType, DeskAlert } from "./types";

function executableTier(tier: TriggerTier | null | undefined): tier is TriggerTier {
  return tier === "prime" || tier === "standard";
}
const HISTORY_LIMIT = 40;
const DISCONNECT_NOTE = "(disconnected)";

export interface AlertEvaluation {
  memory: AlertMemory;
  fresh: DeskAlert[];
}

/** Raise an alert when a live signal or a new A/A+ name appears. Existing active alerts are not duplicated. */
export function evaluateAlerts(
  memory: AlertMemory,
  input: {
    connected: boolean;
    positions: readonly LiveBookRow[];
    scan: readonly ScoredSecurity[];
    setups?: Record<string, SwingSetup>;
  },
): AlertEvaluation {
  const alerts = memory.alerts.map((alert) => ({ ...alert }));
  const fresh: DeskAlert[] = [];
  const now = new Date().toISOString();

  const raise = (type: AlertType, symbol: string, name: string, message: string) => {
    const open = alerts.find((alert) => alert.active && alert.type === type && alert.symbol === symbol);
    if (open) return;
    const alert: DeskAlert = {
      id: `${type}:${symbol}:${now}`,
      type,
      symbol,
      name,
      message,
      createdAt: now,
      read: false,
      active: true,
    };
    alerts.unshift(alert);
    fresh.push(alert);
  };

  // A cleared alert is also marked read, so it cannot keep the unread badge.
  const retire = (alert: DeskAlert, note?: string) => {
    if (!alert.active) return;
    alert.active = false;
    alert.read = true;
    if (note && !alert.message.includes(note)) alert.message = `${alert.message} ${note}`;
  };

  const clear = (type: AlertType, symbol: string, note?: string) => {
    for (const alert of alerts) {
      if (alert.active && alert.type === type && alert.symbol === symbol) retire(alert, note);
    }
  };

  // Exit and book outrank a new caution or strong-buy on the same name. They are never suppressed.
  const blockedByExitOrBook = (symbol: string) =>
    alerts.some((alert) => alert.active && alert.symbol === symbol && (alert.type === "exit" || alert.type === "book"));

  if (!input.connected) {
    // Live exit, book, and caution cannot be refreshed while Kite is down. Trigger and strong-buy stay.
    for (const alert of alerts) {
      if (alert.type === "exit" || alert.type === "book" || alert.type === "caution") retire(alert, DISCONNECT_NOTE);
    }
  } else {
    for (const position of input.positions) {
      if (position.quoteMissing || position.signal.id === "wait") continue;
      const price = formatInr(position.lastClose);
      const outranked = blockedByExitOrBook(position.symbol);
      if (position.signal.id === "exit") {
        raise("exit", position.symbol, position.name, `${position.symbol} at ${price}. ${position.signal.reason}`);
      } else {
        clear("exit", position.symbol);
      }
      if (position.signal.id === "book") {
        raise(
          "book",
          position.symbol,
          position.name,
          `${position.symbol} is up ${formatPercent(position.pnlPercent)}. ${position.signal.reason}`,
        );
      } else {
        clear("book", position.symbol);
      }
      if (position.signal.id === "caution") {
        if (!outranked) {
          raise("caution", position.symbol, position.name, `${position.symbol} at ${price} is on Hold / Caution. ${position.signal.reason}`);
        }
      } else {
        clear("caution", position.symbol);
      }
    }
  }

  const setups = input.setups ?? {};
  // A disconnect must not retire trigger alerts. They clear only when a live setup no longer matches.
  if (input.connected) {
    for (const alert of alerts) {
      if (!alert.active || (alert.type !== "prime" && alert.type !== "standard")) continue;
      if (setups[alert.symbol]?.triggerTier !== alert.type) retire(alert);
    }
  }
  const triggerKeys = input.scan.flatMap((security) => {
    const tier = setups[security.symbol]?.triggerTier;
    return tier ? [`${security.symbol}:${tier}`] : [];
  });
  let seenTriggers = memory.seenTriggers;
  let triggersPrimed = memory.triggersPrimed;
  if (!input.connected || !triggersPrimed) {
    seenTriggers = triggerKeys;
    triggersPrimed = input.connected ? true : triggersPrimed;
  } else {
    for (const security of input.scan) {
      const setup = setups[security.symbol];
      const tier = setup?.triggerTier;
      if (!tier) continue;
      const key = `${security.symbol}:${tier}`;
      if (seenTriggers.includes(key)) continue;
      raise(tier, security.symbol, security.name, executionAlertText({ tier, symbol: security.symbol, sector: security.sector, setup }));
    }
    seenTriggers = triggerKeys;
  }

  // A Strong Buy is a rank plus an executable trigger. Grade A alone stays on the scan.
  const strong = input.scan
    .filter(
      (security) =>
        isStrongGrade(security.grade) && executableTier(setups[security.symbol]?.triggerTier),
    )
    .map((security) => security.symbol);
  const gradeBySymbol = new Map(input.scan.map((security) => [security.symbol, security.grade]));
  if (input.connected) {
    for (const alert of alerts) {
      if (!alert.active || alert.type !== "strong") continue;
      if (!gradeBySymbol.has(alert.symbol)) continue;
      const grade = gradeBySymbol.get(alert.symbol);
      const tier = setups[alert.symbol]?.triggerTier;
      if (isStrongGrade(grade) && executableTier(tier)) continue;
      clear("strong", alert.symbol);
    }
  }
  let seenStrong = memory.seenStrong;
  let primed = memory.primed;
  const strongBlocked = new Set<string>();
  if (!primed) {
    seenStrong = strong;
    primed = true;
  } else {
    for (const security of input.scan) {
      const tier = setups[security.symbol]?.triggerTier;
      if (!isStrongGrade(security.grade) || !executableTier(tier)) continue;
      if (seenStrong.includes(security.symbol)) continue;
      if (blockedByExitOrBook(security.symbol)) {
        // Leave it unseen so the strong-buy can fire after the exit or book alert clears.
        strongBlocked.add(security.symbol);
        continue;
      }
      raise(
        "strong",
        security.symbol,
        security.name,
        `${security.symbol} is ${security.grade} and a ${tier} trigger. Conviction ${security.conviction}.`,
      );
    }
    seenStrong = strong.filter((symbol) => !strongBlocked.has(symbol));
  }

  // One alert per open name once it has been held 10 sessions.
  // The position signal is already an exit when the entry date is known, so this only covers a row that has not flipped yet.
  const openSymbols = new Set(input.positions.map((position) => position.symbol));
  let seenReviews = input.connected
    ? (memory.seenReviews ?? []).filter((symbol) => openSymbols.has(symbol))
    : [...(memory.seenReviews ?? [])];
  if (input.connected) {
    const stillShort = new Set(
      input.positions
        .filter((position) => position.sessionsHeld != null && position.sessionsHeld < MAX_HOLD_SESSIONS)
        .map((position) => position.symbol),
    );
    seenReviews = seenReviews.filter((symbol) => !stillShort.has(symbol));
    for (const position of input.positions) {
      if (position.quoteMissing || !position.holdReview) continue;
      if (position.signal.id === "exit") continue;
      if (seenReviews.includes(position.symbol)) continue;
      raise("review", position.symbol, position.name, `${position.symbol}: ${HOLD_REVIEW_MESSAGE}`);
      seenReviews = [...seenReviews, position.symbol];
    }
  }

  return {
    memory: {
      alerts: alerts.slice(0, HISTORY_LIMIT),
      primed,
      seenStrong,
      triggersPrimed,
      seenTriggers,
      seenReviews,
    },
    fresh,
  };
}

import { describe, expect, it } from "vitest";
import type { LiveBookRow } from "../portfolio/liveBook";
import type { SwingSetup } from "../recommendations/setup";
import type { Grade, ScoredSecurity } from "../scanner";
import type { PositionSignal } from "../strategy/policy";
import { evaluateAlerts } from "./evaluate";
import { EMPTY_ALERT_MEMORY, type AlertMemory, type DeskAlert } from "./types";

function alert(partial: Partial<DeskAlert> & Pick<DeskAlert, "type" | "symbol">): DeskAlert {
  return {
    id: `${partial.type}:${partial.symbol}:t`,
    name: partial.symbol,
    message: partial.message ?? partial.symbol,
    createdAt: "2026-11-01T00:00:00.000Z",
    read: false,
    active: true,
    ...partial,
  };
}

function memory(partial: Partial<AlertMemory> = {}): AlertMemory {
  return { ...EMPTY_ALERT_MEMORY, primed: true, triggersPrimed: true, ...partial };
}

function triggered(tier: "prime" | "standard"): SwingSetup {
  return { triggerTier: tier } as SwingSetup;
}

function security(symbol: string, grade: Grade | null, conviction = 80): ScoredSecurity {
  return {
    symbol,
    name: symbol,
    sector: "Energy",
    factors: [],
    conviction,
    grade,
    stance: "Strong",
    tone: "strong",
    action: "Watch",
  };
}

function position(symbol: string, signal: PositionSignal["id"], sessionsHeld: number | null = 3): LiveBookRow {
  const reason =
    signal === "exit"
      ? "Close is below EMA 20."
      : signal === "book"
        ? "Target hit."
        : signal === "caution"
          ? "Above EMA 20, but it is no longer ahead of Nifty."
          : "Above EMA 20.";
  return {
    symbol,
    name: symbol,
    sector: "Energy",
    entry: 100,
    quantity: 10,
    lastClose: 110,
    ema20: 105,
    trueRs: 80,
    pnl: 100,
    pnlPercent: 0.1,
    signal: { id: signal, label: signal, tone: "watch", reason },
    source: "kite",
    exchange: "NSE",
    priceSource: "live",
    emaSource: "live",
    quoteMissing: false,
    t1Quantity: 0,
    tranchePlan: {} as LiveBookRow["tranchePlan"],
    technicals: {} as LiveBookRow["technicals"],
    sessionsHeld,
    holdReview: sessionsHeld != null && sessionsHeld >= 10,
  };
}

describe("alert priority and clearing", () => {
  it("does not count a cleared alert, and marks it read", () => {
    const prior = alert({ type: "exit", symbol: "INFY" });
    const result = evaluateAlerts(memory({ alerts: [prior] }), {
      connected: true,
      positions: [position("INFY", "hold")],
      scan: [],
    });
    expect(result.memory.alerts[0]?.active).toBe(false);
    expect(result.memory.alerts[0]?.read).toBe(true);
    expect(result.memory.alerts.filter((row) => row.active && !row.read)).toHaveLength(0);
  });

  it("suppresses a new strong buy and a new caution while an exit or book alert is active", () => {
    const blocked = evaluateAlerts(
      memory({
        alerts: [
          alert({ type: "exit", symbol: "RELIANCE" }),
          alert({ type: "book", symbol: "TCS" }),
          alert({ type: "exit", symbol: "HDFCBANK" }),
        ],
      }),
      {
        connected: true,
        positions: [position("RELIANCE", "exit"), position("TCS", "book"), position("HDFCBANK", "caution")],
        scan: [security("RELIANCE", "A+"), security("TCS", "A")],
        setups: { RELIANCE: triggered("prime"), TCS: triggered("standard") },
      },
    );
    expect(blocked.fresh.map((row) => row.type)).not.toContain("strong");
    expect(blocked.fresh.map((row) => `${row.type}:${row.symbol}`)).not.toContain("caution:HDFCBANK");
    expect(blocked.memory.seenStrong).not.toContain("RELIANCE");
    expect(blocked.memory.seenStrong).not.toContain("TCS");

    const released = evaluateAlerts(memory({ seenStrong: blocked.memory.seenStrong, seenTriggers: blocked.memory.seenTriggers, alerts: [] }), {
      connected: true,
      positions: [position("RELIANCE", "hold"), position("TCS", "hold"), position("HDFCBANK", "caution")],
      scan: [security("RELIANCE", "A+"), security("TCS", "A")],
      setups: { RELIANCE: triggered("prime"), TCS: triggered("standard") },
    });
    expect(released.fresh.map((row) => `${row.type}:${row.symbol}`).sort()).toEqual([
      "caution:HDFCBANK",
      "strong:RELIANCE",
      "strong:TCS",
    ]);
  });

  it("still raises an exit while a strong buy is active", () => {
    const result = evaluateAlerts(memory({ alerts: [alert({ type: "strong", symbol: "SBIN" })] }), {
      connected: true,
      positions: [position("SBIN", "exit")],
      scan: [security("SBIN", "A")],
    });
    expect(result.fresh.map((row) => row.type)).toContain("exit");
  });

  it("does not raise a strong buy for a grade A name that has no trigger", () => {
    const ranked = evaluateAlerts(memory(), {
      connected: true,
      positions: [],
      scan: [security("RELIANCE", "A+", 91)],
    });
    expect(ranked.fresh.map((row) => row.type)).not.toContain("strong");

    const fired = evaluateAlerts(memory({ seenTriggers: ["RELIANCE:prime"] }), {
      connected: true,
      positions: [],
      scan: [security("RELIANCE", "A+", 91)],
      setups: { RELIANCE: triggered("prime") },
    });
    expect(fired.fresh.map((row) => row.message)).toEqual([
      "RELIANCE is A+ and a prime trigger. Conviction 91.",
    ]);
  });

  it("clears a strong buy when the trigger is gone, even if the grade is still A", () => {
    const result = evaluateAlerts(memory({ alerts: [alert({ type: "strong", symbol: "WIPRO" })], seenStrong: ["WIPRO"] }), {
      connected: true,
      positions: [],
      scan: [security("WIPRO", "A")],
    });
    const row = result.memory.alerts.find((item) => item.type === "strong");
    expect(row?.active).toBe(false);
    expect(row?.read).toBe(true);
  });

  it("clears a strong buy when the scanned grade falls below A", () => {
    const result = evaluateAlerts(memory({ alerts: [alert({ type: "strong", symbol: "WIPRO" })], seenStrong: ["WIPRO"] }), {
      connected: true,
      positions: [],
      scan: [security("WIPRO", "B")],
    });
    const row = result.memory.alerts.find((item) => item.type === "strong");
    expect(row?.active).toBe(false);
    expect(row?.read).toBe(true);
  });

  it("raises the 10-session review once and does not exit", () => {
    const first = evaluateAlerts(memory(), {
      connected: true,
      positions: [position("LT", "hold", 10)],
      scan: [],
    });
    expect(first.fresh.map((row) => row.type)).toEqual(["review"]);
    expect(first.fresh[0]?.message).toBe("LT: Held 10 sessions with gain under +2%. Exit dead money.");

    const second = evaluateAlerts(memory({ alerts: first.memory.alerts, seenReviews: first.memory.seenReviews }), {
      connected: true,
      positions: [position("LT", "hold", 12)],
      scan: [],
    });
    expect(second.fresh).toHaveLength(0);
    expect(second.memory.alerts.filter((row) => row.type === "review" && row.active)).toHaveLength(1);
  });

  it("clears exit, book, and caution on disconnect and leaves trigger and strong buy alerts", () => {
    const result = evaluateAlerts(
      memory({
        alerts: [
          alert({ type: "exit", symbol: "INFY", message: "INFY at ₹1. Stop." }),
          alert({ type: "book", symbol: "TCS" }),
          alert({ type: "caution", symbol: "SBIN" }),
          alert({ type: "strong", symbol: "RELIANCE" }),
          alert({ type: "prime", symbol: "LT" }),
          alert({ type: "review", symbol: "ASIANPAINT" }),
        ],
      }),
      { connected: false, positions: [], scan: [security("LT", "B")] },
    );
    const byType = Object.fromEntries(result.memory.alerts.map((row) => [row.type, row]));
    expect(byType.exit?.active).toBe(false);
    expect(byType.exit?.read).toBe(true);
    expect(byType.exit?.message).toContain("(disconnected)");
    expect(byType.book?.active).toBe(false);
    expect(byType.caution?.active).toBe(false);
    expect(byType.strong?.active).toBe(true);
    expect(byType.prime?.active).toBe(true);
    expect(byType.review?.active).toBe(true);
    expect(result.fresh).toHaveLength(0);
  });
});

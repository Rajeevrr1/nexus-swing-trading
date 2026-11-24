import { describe, expect, it } from "vitest";
import { freshSessionDate, type KiteHistoryCacheFile } from "./historyCache";

function cacheSavedAt(iso: string, lastBarDate = "2026-11-23"): KiteHistoryCacheFile {
  return {
    savedAt: iso,
    source: "kite",
    days: 420,
    histories: {
      INFY: [{ date: lastBarDate, open: 1500, high: 1520, low: 1490, close: 1510, volume: 100_000 }],
    },
  };
}

describe("freshSessionDate (settled EOD + IST market-hours aware)", () => {
  it("keeps yesterday's settled EOD cache valid across market hours until 15:35 IST", () => {
    // Tuesday 2026-11-24 10:00 IST (04:30 UTC), holding Monday 2026-11-23 closed candle
    const saved = cacheSavedAt("2026-11-24T04:30:00.000Z", "2026-11-23");
    const midday = Date.parse("2026-11-24T07:00:00.000Z"); // 12:30 IST
    expect(freshSessionDate(saved, midday)).toBe("2026-11-23");
  });

  it("rejects any dirty cache containing today's incomplete intraday candle during market hours", () => {
    // Cache accidentally has today's 2026-11-24 bar while it is still 10:05 IST
    const dirty = cacheSavedAt("2026-11-24T04:30:00.000Z", "2026-11-24");
    const duringMarket = Date.parse("2026-11-24T04:35:00.000Z");
    expect(freshSessionDate(dirty, duringMarket)).toBeNull();
  });

  it("immediately expires a market-hours cache once 15:35 IST settles", () => {
    // Saved at 15:32 IST (10:02 UTC), checked at 15:36 IST (10:06 UTC) -> session settled!
    const saved = cacheSavedAt("2026-11-24T10:02:00.000Z", "2026-11-23");
    const afterClose = Date.parse("2026-11-24T10:06:00.000Z");
    expect(freshSessionDate(saved, afterClose)).toBeNull();
  });

  it("keeps a post-close settled cache fresh for up to 12 hours", () => {
    // Saved at 16:00 IST (10:30 UTC) with today's settled 2026-11-24 bar, checked at 22:00 IST
    const saved = cacheSavedAt("2026-11-24T10:30:00.000Z", "2026-11-24");
    const evening = Date.parse("2026-11-24T16:30:00.000Z");
    expect(freshSessionDate(saved, evening)).toBe("2026-11-24");
  });

  it("expires a pre-market cache once the same day's 15:35 IST close settles", () => {
    // Saved at 08:30 IST (03:00 UTC) with yesterday's bar; stays valid at 10:00 IST, expires at 15:40 IST
    const saved = cacheSavedAt("2026-11-24T03:00:00.000Z", "2026-11-23");
    expect(freshSessionDate(saved, Date.parse("2026-11-24T04:30:00.000Z"))).toBe("2026-11-23");
    expect(freshSessionDate(saved, Date.parse("2026-11-24T10:10:00.000Z"))).toBeNull();
  });
});

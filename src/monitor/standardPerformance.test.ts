import { describe, expect, it } from "vitest";
import {
  appendStandardTrade,
  evaluateStandardWarning,
  rollingStandardMetrics,
  STANDARD_HISTORY_LIMIT,
  STANDARD_METRICS_WINDOW,
  STANDARD_WARNING_MESSAGE,
  STANDARD_WARNING_MIN_SAMPLE,
  type StandardClosedTrade,
} from "./standardPerformance";

function trade(id: number, pnlPercent: number, rMultiple: number | null = pnlPercent * 2): StandardClosedTrade {
  return {
    id: `t-${id}`,
    symbol: "INFY",
    entryDate: "2026-01-01",
    exitDate: "2026-01-10",
    rMultiple,
    pnlPercent,
    result: pnlPercent > 0 ? "win" : "loss",
  };
}

describe("rollingStandardMetrics", () => {
  it("uses every trade when fewer than 30 are closed", () => {
    const metrics = rollingStandardMetrics([trade(1, 0.04, 1), trade(2, -0.02, -0.5)]);
    expect(metrics.sample).toBe(2);
    expect(metrics.winRate).toBe(0.5);
    expect(metrics.expectancy).toBeCloseTo(0.01);
    expect(metrics.avgR).toBeCloseTo(0.25);
    expect(metrics.profitFactor).toBeCloseTo(2);
  });

  it("ignores trades older than the last 30", () => {
    const history = Array.from({ length: 40 }, (_, index) => trade(index, index < 10 ? -0.1 : 0.02));
    const metrics = rollingStandardMetrics(history);
    expect(metrics.sample).toBe(STANDARD_METRICS_WINDOW);
    expect(metrics.winRate).toBe(1);
    expect(metrics.expectancy).toBeCloseTo(0.02);
  });

  it("leaves average R empty when no stop was logged", () => {
    const metrics = rollingStandardMetrics([trade(1, 0.03, null)]);
    expect(metrics.avgR).toBeNull();
    expect(metrics.expectancy).toBeCloseTo(0.03);
  });
});

describe("evaluateStandardWarning", () => {
  it("does not warn below the minimum closed-trade sample", () => {
    const smallSample = Array.from({ length: STANDARD_WARNING_MIN_SAMPLE - 1 }, (_, index) =>
      trade(index + 1, -0.02),
    );
    const result = evaluateStandardWarning(rollingStandardMetrics(smallSample));
    expect(result.standardPerformanceWarning).toBe(false);
    expect(result.warningMessage).toBeNull();
  });

  it("warns once minimum sample is met and expectancy is negative", () => {
    const enoughLosses = Array.from({ length: STANDARD_WARNING_MIN_SAMPLE }, (_, index) =>
      trade(index + 1, -0.01),
    );
    const negative = evaluateStandardWarning(rollingStandardMetrics(enoughLosses));
    expect(negative.standardPerformanceWarning).toBe(true);
    expect(negative.warningMessage).toBe(STANDARD_WARNING_MESSAGE);

    const enoughFlat = Array.from({ length: STANDARD_WARNING_MIN_SAMPLE }, (_, index) =>
      trade(index + 1, 0),
    );
    const flat = evaluateStandardWarning(rollingStandardMetrics(enoughFlat));
    expect(flat.standardPerformanceWarning).toBe(false);
    expect(flat.warningMessage).toBeNull();
  });
});

describe("appendStandardTrade", () => {
  it("keeps the newest 50 and replaces a repeated id", () => {
    const history = Array.from({ length: STANDARD_HISTORY_LIMIT }, (_, index) => trade(index, 0.01));
    const next = appendStandardTrade(history, trade(99, 0.05));
    expect(next).toHaveLength(STANDARD_HISTORY_LIMIT);
    expect(next[0]?.id).toBe("t-1");
    expect(next.at(-1)?.id).toBe("t-99");

    const replaced = appendStandardTrade(next, { ...trade(99, -0.04), symbol: "TCS" });
    expect(replaced.filter((row) => row.id === "t-99")).toHaveLength(1);
    expect(replaced.at(-1)?.symbol).toBe("TCS");
  });
});

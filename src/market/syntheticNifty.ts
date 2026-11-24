import type { PriceBar } from "../analysis";

/** Equal-weight book proxy when NIFTY 50 history is unavailable (sample / offline backtests). */
export function syntheticNiftyFromUniverse(histories: Record<string, readonly PriceBar[]>): PriceBar[] {
  const byDate = new Map<string, { open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] }>();
  for (const bars of Object.values(histories)) {
    for (const bar of bars) {
      const row = byDate.get(bar.date) ?? { open: [], high: [], low: [], close: [], volume: [] };
      row.open.push(bar.open);
      row.high.push(bar.high);
      row.low.push(bar.low);
      row.close.push(bar.close);
      if (bar.volume != null) row.volume.push(bar.volume);
      byDate.set(bar.date, row);
    }
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, row]) => {
      const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
      const close = mean(row.close);
      return {
        date,
        label: date,
        open: mean(row.open),
        high: mean(row.high),
        low: mean(row.low),
        close,
        volume: row.volume.length > 0 ? Math.round(mean(row.volume)) : undefined,
      };
    });
}

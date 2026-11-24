import type { HoldingInput } from "./holdings";

const KEY = "nexus-added-holdings";

function isHolding(value: unknown): value is HoldingInput {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<HoldingInput>;
  return (
    typeof row.symbol === "string" &&
    typeof row.entry === "number" &&
    Number.isFinite(row.entry) &&
    row.entry > 0 &&
    typeof row.quantity === "number" &&
    Number.isFinite(row.quantity) &&
    row.quantity > 0 &&
    (row.source === "sample" || row.source === "added")
  );
}

export function loadAddedHoldings(): HoldingInput[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(isHolding).map((row) => ({ ...row, source: "added" as const }))
      : [];
  } catch {
    return [];
  }
}

export function saveAddedHoldings(holdings: readonly HoldingInput[]): void {
  if (typeof window === "undefined") return;
  try {
    const payload = holdings
      .filter((row) => row.source === "added")
      .map((row) => ({ symbol: row.symbol, entry: row.entry, quantity: row.quantity, source: "added" as const }));
    window.localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // Quota or private mode.
  }
}

import type { JournalTrade } from "./stats";

const KEY = "nexus-journal";

function isTrade(value: unknown): value is JournalTrade {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  return (
    typeof t.id === "string" &&
    typeof t.symbol === "string" &&
    typeof t.entryDate === "string" &&
    num(t.entryPrice) &&
    num(t.qty) &&
    (t.stopPrice === null || num(t.stopPrice)) &&
    (t.exitDate === null || typeof t.exitDate === "string") &&
    (t.exitPrice === null || num(t.exitPrice)) &&
    typeof t.note === "string"
  );
}

function withTier(trade: JournalTrade): JournalTrade {
  const raw = (trade as { triggerTier?: unknown }).triggerTier;
  return { ...trade, triggerTier: raw === "prime" || raw === "standard" ? raw : null };
}

export function loadJournal(): JournalTrade[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isTrade).map(withTier) : [];
  } catch {
    return [];
  }
}

export function saveJournal(trades: readonly JournalTrade[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(trades));
  } catch {
    // Quota or private mode: journal still works for this page load.
  }
}

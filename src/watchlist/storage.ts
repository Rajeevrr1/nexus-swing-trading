const KEY = "nexus-watchlist";

function parse(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && /^[A-Z][A-Z0-9&-]{0,24}$/.test(item));
  } catch {
    return [];
  }
}

/** Persistent (localStorage). Migrates any list left in sessionStorage by older builds. */
export function loadWatchlist(): string[] {
  try {
    const stored = parse(window.localStorage.getItem(KEY));
    const legacy = parse(window.sessionStorage.getItem(KEY));
    if (legacy.length === 0) return stored;
    const merged = [...new Set([...stored, ...legacy])];
    window.localStorage.setItem(KEY, JSON.stringify(merged));
    window.sessionStorage.removeItem(KEY);
    return merged;
  } catch {
    return [];
  }
}

export function saveWatchlist(symbols: readonly string[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(symbols));
  } catch {
    // Still works for this page load.
  }
}

export type AutoRefreshOption = 0 | 30_000 | 60_000 | 300_000;

export const AUTO_REFRESH_OPTIONS: readonly { id: AutoRefreshOption; label: string }[] = [
  { id: 0, label: "Off" },
  { id: 30_000, label: "30s" },
  { id: 60_000, label: "1 min" },
  { id: 300_000, label: "5 min" },
];

const STORAGE_KEY = "nexus-auto-refresh-ms";

export function loadAutoRefreshMs(): AutoRefreshOption {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return 0;
    const parsed = Number(raw);
    if (parsed === 30_000 || parsed === 60_000 || parsed === 300_000) return parsed;
    return 0;
  } catch {
    return 0;
  }
}

export function saveAutoRefreshMs(value: AutoRefreshOption): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // ignore quota errors
  }
}

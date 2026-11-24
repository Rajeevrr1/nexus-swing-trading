const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

interface IstParts {
  y: number;
  m: number;
  d: number;
}

function istParts(ms: number): IstParts {
  const shifted = new Date(ms + IST_OFFSET_MS);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
  };
}

function istTime(year: number, month: number, day: number, hour: number, minute: number): number {
  return Date.UTC(year, month, day, hour, minute, 0) - IST_OFFSET_MS;
}

/** Zerodha access tokens stop working at the next 6:00 AM IST. */
export function kiteExpiresAt(obtainedAtMs: number): number {
  const parts = istParts(obtainedAtMs);
  const sameMorning = istTime(parts.y, parts.m, parts.d, 6, 0);
  if (obtainedAtMs < sameMorning) return sameMorning;
  return istTime(parts.y, parts.m, parts.d + 1, 6, 0);
}

export function isKiteTokenExpired(obtainedAtMs: number, nowMs = Date.now()): boolean {
  return nowMs >= kiteExpiresAt(obtainedAtMs);
}

/** Next 8:45 AM IST, which is before the NSE cash open. */
export function nextMorningRefresh(nowMs = Date.now()): number {
  const parts = istParts(nowMs);
  const today = istTime(parts.y, parts.m, parts.d, 8, 45);
  if (nowMs < today) return today;
  return istTime(parts.y, parts.m, parts.d + 1, 8, 45);
}

export function morningRefreshDue(lastRefreshMs: number | null, nowMs = Date.now()): boolean {
  const parts = istParts(nowMs);
  const today = istTime(parts.y, parts.m, parts.d, 8, 45);
  if (nowMs < today) return false;
  return lastRefreshMs == null || lastRefreshMs < today;
}

export function formatRefreshTime(iso: string | null): string {
  if (!iso) return "Not refreshed yet";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Not refreshed yet";
  const clock = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return `${clock} IST`;
}

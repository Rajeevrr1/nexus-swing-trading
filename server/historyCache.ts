import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const KITE_HISTORY_CACHE_PATH = process.env.CACHE_DIR
  ? join(process.env.CACHE_DIR, "kite-history.json")
  : ".cache/kite-history.json";

export interface CachedHistoryBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  label?: string;
}

export interface KiteHistoryCacheFile {
  savedAt: string;
  source: "kite";
  days: number;
  histories: Record<string, CachedHistoryBar[]>;
}

export function saveKiteHistoryCache(
  incoming: Record<string, CachedHistoryBar[]>,
  days = 420,
  file = KITE_HISTORY_CACHE_PATH,
): void {
  const current = loadKiteHistoryCache(file);
  const histories = { ...(current?.histories ?? {}) };
  for (const [symbol, bars] of Object.entries(incoming)) {
    if (bars.length === 0) continue;
    histories[symbol] = bars.map((bar) => ({
      date: bar.date,
      label: bar.label ?? bar.date,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      ...(bar.volume != null && bar.volume > 0 ? { volume: bar.volume } : {}),
    }));
  }
  try {
    mkdirSync(dirname(file), { recursive: true });
    const payload: KiteHistoryCacheFile = {
      savedAt: new Date().toISOString(),
      source: "kite",
      days,
      histories,
    };
    writeFileSync(file, JSON.stringify(payload));
  } catch {
    // Ephemeral/read-only container fallback: response still succeeds without caching on disk.
  }
}

const IST = "Asia/Kolkata";
const MARKET_OPEN_MIN = 9 * 60 + 15;
const MARKET_CLOSE_SETTLED_MIN = 15 * 60 + 35;
const POST_CLOSE_TTL_MS = 12 * 60 * 60 * 1000;

function istClock(ms: number): { dateKey: string; weekday: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const read = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    dateKey: `${read("year")}-${read("month")}-${read("day")}`,
    weekday: read("weekday"),
    minutes: Number(read("hour")) * 60 + Number(read("minute")),
  };
}

function isMarketHours(clock: { weekday: string; minutes: number }): boolean {
  const weekend = clock.weekday === "Sat" || clock.weekday === "Sun";
  return !weekend && clock.minutes >= MARKET_OPEN_MIN && clock.minutes < MARKET_CLOSE_SETTLED_MIN;
}

/**
 * A symbol is fresh when its last bar matches the cached settled EOD session AND the cache is not stale:
 * - Never trust a cache whose latest bar is today's incomplete intraday candle during 09:15–15:35 IST.
 * - A settled EOD cache stays valid across the trading day until 15:35 IST settles (avoids hammering
 *   Kite with 100 historical requests every 5 minutes while still expiring immediately at 15:35 IST).
 * - Post-close / weekend caches expire after 12 hours or once a new weekday EOD settles past 15:35 IST.
 */
export function freshSessionDate(cache: KiteHistoryCacheFile, nowMs = Date.now()): string | null {
  const savedAt = Date.parse(cache.savedAt);
  if (!Number.isFinite(savedAt) || nowMs < savedAt) return null;
  const ageMs = nowMs - savedAt;
  const savedClock = istClock(savedAt);
  const nowClock = istClock(nowMs);
  const dates = Object.values(cache.histories)
    .map((bars) => bars.at(-1)?.date)
    .filter((date): date is string => Boolean(date));
  if (dates.length === 0) return null;
  const latestBarDate = dates.sort().at(-1) ?? null;
  if (!latestBarDate) return null;

  // Reject any cache that accidentally captured an incomplete intraday candle for today.
  if (isMarketHours(nowClock) && latestBarDate >= nowClock.dateKey) return null;

  if (isMarketHours(savedClock)) {
    // Saved during market hours: invalidate immediately once today's 15:35 IST close settles or date advances.
    const settledAfterSave =
      nowClock.dateKey !== savedClock.dateKey || nowClock.minutes >= MARKET_CLOSE_SETTLED_MIN;
    if (settledAfterSave || ageMs > POST_CLOSE_TTL_MS) return null;
  } else {
    if (ageMs > POST_CLOSE_TTL_MS) return null;
    const weekday = nowClock.weekday !== "Sat" && nowClock.weekday !== "Sun";
    // If saved pre-market today and today's close has now settled (>= 15:35 IST), refresh for today's EOD bar.
    const todaySettledAfterPreMarketSave =
      weekday &&
      nowClock.dateKey === savedClock.dateKey &&
      savedClock.minutes < MARKET_CLOSE_SETTLED_MIN &&
      nowClock.minutes >= MARKET_CLOSE_SETTLED_MIN;
    if (todaySettledAfterPreMarketSave) return null;
  }
  return latestBarDate;
}

export function cachedBarsAreFresh(
  bars: readonly { date: string }[] | undefined,
  sessionDate: string | null,
  minBars = 180,
): boolean {
  if (!sessionDate || !bars || bars.length < minBars) return false;
  return bars.at(-1)?.date === sessionDate;
}

export function loadKiteHistoryCache(file = KITE_HISTORY_CACHE_PATH): KiteHistoryCacheFile | null {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as KiteHistoryCacheFile;
    if (!parsed?.histories || typeof parsed.histories !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

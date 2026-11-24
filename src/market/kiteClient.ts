import type { PriceBar } from "../analysis";

export interface KiteStatus {
  configured: boolean;
  connected: boolean;
  expired: boolean;
  userName: string | null;
  userId: string | null;
  redirectUrl: string;
  lastRefreshAt: string | null;
  expiresAt: string | null;
}

export class KiteAuthError extends Error {
  expired: boolean;

  constructor(expired: boolean) {
    super(expired ? "Kite session expired." : "Kite is not connected.");
    this.name = "KiteAuthError";
    this.expired = expired;
  }
}

export interface KiteHolding {
  symbol: string;
  exchange: string;
  quantity: number;
  t1Quantity: number;
  averagePrice: number;
  lastPrice: number;
  instrumentToken: number;
}

export interface LiveQuote {
  symbol: string;
  lastPrice: number;
  previousClose: number;
  instrumentToken: number;
}

const EMPTY_STATUS: KiteStatus = {
  configured: false,
  connected: false,
  expired: false,
  userName: null,
  userId: null,
  redirectUrl: "http://127.0.0.1:8000/api/v1/broker/kite/callback",
  lastRefreshAt: null,
  expiresAt: null,
};

export async function fetchKiteStatus(): Promise<KiteStatus> {
  const response = await fetch("/api/kite/status");
  if (!response.ok) return EMPTY_STATUS;
  return (await response.json()) as KiteStatus;
}

export async function fetchKiteQuotes(
  symbols: readonly string[],
): Promise<{ quotes: LiveQuote[]; missing: string[]; refreshedAt: string | null }> {
  const response = await fetch(`/api/kite/quotes?symbols=${encodeURIComponent(symbols.join(","))}`);
  if (response.status === 401) {
    const body = (await response.json().catch(() => ({}))) as { expired?: boolean };
    throw new KiteAuthError(Boolean(body.expired));
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || "Kite quotes failed.");
  }
  const payload = (await response.json()) as { quotes?: LiveQuote[]; missing?: string[]; refreshedAt?: string | null };
  const quotes = payload.quotes ?? [];
  const missing = payload.missing ?? [];
  console.info(`[kite] quotes returned=${quotes.length} missing=${missing.length ? missing.join(",") : "none"}`);
  return { quotes, missing, refreshedAt: payload.refreshedAt ?? null };
}

export async function fetchKiteHoldings(): Promise<KiteHolding[]> {
  const response = await fetch("/api/kite/holdings");
  if (response.status === 401) {
    const body = (await response.json().catch(() => ({}))) as { expired?: boolean };
    throw new KiteAuthError(Boolean(body.expired));
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || "Kite holdings request failed.");
  }
  const payload = (await response.json()) as { holdings?: KiteHolding[] };
  const holdings = payload.holdings ?? [];
  console.info(`[kite] holdings count=${holdings.length}`);
  return holdings;
}

async function readHistoryResponse(response: Response): Promise<Record<string, PriceBar[]>> {
  if (response.status === 401) {
    const body = (await response.json().catch(() => ({}))) as { expired?: boolean };
    throw new KiteAuthError(Boolean(body.expired));
  }
  if (!response.ok) throw new Error("Kite history failed.");
  const payload = (await response.json()) as {
    histories?: Record<string, { date: string; open: number; high: number; low: number; close: number; volume?: number }[]>;
  };
  const histories: Record<string, PriceBar[]> = {};
  for (const [symbol, bars] of Object.entries(payload.histories ?? {})) {
    histories[symbol] = bars.map((bar) => ({
      ...bar,
      label: labelFor(bar.date),
    }));
  }
  return histories;
}

export async function fetchKiteHistory(
  symbols: readonly string[],
  days = 200,
): Promise<Record<string, PriceBar[]>> {
  const response = await fetch(
    `/api/kite/history?symbols=${encodeURIComponent(symbols.join(","))}&days=${encodeURIComponent(String(days))}`,
  );
  return readHistoryResponse(response);
}

export async function fetchKiteHistoryPairs(
  holdings: readonly { symbol: string; instrumentToken: number }[],
): Promise<Record<string, PriceBar[]>> {
  if (holdings.length === 0) return {};
  const pairs = holdings.map((holding) => `${holding.symbol}:${holding.instrumentToken}`).join(",");
  const response = await fetch(`/api/kite/history?pairs=${encodeURIComponent(pairs)}`);
  return readHistoryResponse(response);
}

export async function saveKiteCredentials(apiKey: string, apiSecret: string): Promise<void> {
  const response = await fetch("/api/kite/credentials", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey, apiSecret }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || "Could not store the Kite key.");
  }
}

export async function logoutKite(): Promise<void> {
  await fetch("/api/kite/logout", { method: "POST" });
}

function labelFor(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

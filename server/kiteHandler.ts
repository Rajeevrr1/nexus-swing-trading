import { createHash, randomBytes } from "node:crypto";
import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isKiteTokenExpired, kiteExpiresAt } from "../src/market/schedule";
import { cachedBarsAreFresh, freshSessionDate, loadKiteHistoryCache, saveKiteHistoryCache } from "./historyCache";
import { sealSession, unsealSession } from "./sessionCrypto";

const COOKIE_SID = "kite_sid";
const COOKIE_ENC = "kite_enc";
const KITE_LOGIN = "https://kite.zerodha.com/connect/login";
const KITE_API = "https://api.kite.trade";
/** NSE renamed the Tata Motors passenger-vehicle share. The desk still says TATAMOTORS. */
const NSE_ALIASES: Record<string, string> = { TATAMOTORS: "TMPV", NIFTY: "NIFTY 50" };
/** Default local callback registered with Zerodha when APP_ORIGIN is unset. */
export const KITE_REDIRECT_URL = "http://127.0.0.1:8000/api/v1/broker/kite/callback";

export interface KiteSession {
  accessToken: string;
  userId: string;
  userName: string;
  obtainedAt: string;
}

export interface SessionStore {
  lastRefreshAt: string | null;
  sessions: Record<string, KiteSession>;
}

export interface KiteEnv {
  apiKey: string;
  apiSecret: string;
  /** Path to .env when running locally; null in read-only cloud containers. */
  envPath: string | null;
  appOrigin: string;
  redirectUrl: string;
  sessionSecret: string;
  sessions: Map<string, KiteSession>;
  expiredSids: Set<string>;
  lastRefreshAt: string | null;
  save: () => void;
}

function emptyStore(): SessionStore {
  return { lastRefreshAt: null, sessions: {} };
}

export function loadKiteStore(file: string): { store: SessionStore; expiredSids: Set<string> } {
  const expiredSids = new Set<string>();
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<SessionStore>;
    const sessions: Record<string, KiteSession> = {};
    for (const [sid, session] of Object.entries(parsed.sessions ?? {})) {
      if (!session || typeof session.accessToken !== "string" || typeof session.obtainedAt !== "string") continue;
      if (isKiteTokenExpired(Date.parse(session.obtainedAt))) {
        expiredSids.add(sid);
        continue;
      }
      sessions[sid] = {
        accessToken: session.accessToken,
        userId: typeof session.userId === "string" ? session.userId : "",
        userName: typeof session.userName === "string" ? session.userName : "",
        obtainedAt: session.obtainedAt,
      };
    }
    return {
      store: {
        lastRefreshAt: typeof parsed.lastRefreshAt === "string" ? parsed.lastRefreshAt : null,
        sessions,
      },
      expiredSids,
    };
  } catch {
    return { store: emptyStore(), expiredSids };
  }
}

export function writeKiteStore(file: string, store: SessionStore) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(store), { mode: 0o600 });
  renameSync(tmp, file);
  try {
    chmodSync(file, 0o600);
  } catch {
    // Already private.
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

export function readCookie(req: IncomingMessage, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function isHttpsRequest(req: IncomingMessage, env: KiteEnv): boolean {
  const proto = String(req.headers["x-forwarded-proto"] ?? "").toLowerCase();
  return proto === "https" || env.appOrigin.startsWith("https://");
}

function cookieFlags(req: IncomingMessage, env: KiteEnv, maxAge: number): string {
  const secure = isHttpsRequest(req, env) ? "; Secure" : "";
  return `HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

function clearSessionCookies(req: IncomingMessage, res: ServerResponse, env: KiteEnv) {
  const flags = cookieFlags(req, env, 0);
  res.setHeader("set-cookie", [`${COOKIE_SID}=; ${flags}`, `${COOKIE_ENC}=; ${flags}`]);
}

function routePath(pathname: string): string {
  const broker = "/api/v1/broker/kite";
  if (pathname === broker || pathname.startsWith(`${broker}/`)) {
    return `/api/kite${pathname.slice(broker.length)}`;
  }
  return pathname;
}

function kiteLog(message: string) {
  console.info(`[kite] ${message}`);
}

function nseTradingSymbol(symbol: string): string {
  return NSE_ALIASES[symbol] ?? symbol;
}

function symbolsFrom(params: URLSearchParams): string[] {
  const raw = params.get("symbols") ?? "";
  const symbols = raw
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => /^[A-Z][A-Z0-9&-]{0,24}$/.test(symbol));
  return [...new Set(symbols)].slice(0, 120);
}

function effectiveSecret(env: KiteEnv): string {
  return env.sessionSecret || `${env.apiSecret}:${env.apiKey}` || "nexus-local-session";
}

function takeSession(req: IncomingMessage, env: KiteEnv): { session: KiteSession | null; expired: boolean } {
  const sid = readCookie(req, COOKIE_SID);
  if (sid) {
    if (env.expiredSids.has(sid)) {
      env.expiredSids.delete(sid);
      return { session: null, expired: true };
    }
    const inMem = env.sessions.get(sid);
    if (inMem) {
      if (isKiteTokenExpired(Date.parse(inMem.obtainedAt))) {
        env.sessions.delete(sid);
        env.save();
        return { session: null, expired: true };
      }
      return { session: inMem, expired: false };
    }
  }
  // Stateless fallback: decrypt AES-256-GCM session cookie (survives Cloud Run cold starts!).
  const enc = readCookie(req, COOKIE_ENC);
  if (enc) {
    const restored = unsealSession<KiteSession>(enc, effectiveSecret(env));
    if (restored && typeof restored.accessToken === "string" && typeof restored.obtainedAt === "string") {
      if (isKiteTokenExpired(Date.parse(restored.obtainedAt))) {
        return { session: null, expired: true };
      }
      if (sid) env.sessions.set(sid, restored);
      return { session: restored, expired: false };
    }
  }
  return { session: null, expired: false };
}

function dropSession(req: IncomingMessage, res: ServerResponse, env: KiteEnv) {
  const sid = readCookie(req, COOKIE_SID);
  if (sid) {
    env.sessions.delete(sid);
    env.save();
  }
  clearSessionCookies(req, res, env);
}

async function kiteFetch(path: string, apiKey: string, accessToken: string, init?: RequestInit) {
  return fetch(`${KITE_API}${path}`, {
    ...init,
    headers: {
      "X-Kite-Version": "3",
      Authorization: `token ${apiKey}:${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 8_000) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function credentialValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9]{8,128}$/.test(trimmed)) return null;
  return trimmed;
}

function writeCredentials(file: string, apiKey: string, apiSecret: string) {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    text = "";
  }
  const lines = text.split(/\r?\n/).filter((line) => !/^KITE_API_(KEY|SECRET)=/.test(line));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  lines.push(`KITE_API_KEY=${apiKey}`, `KITE_API_SECRET=${apiSecret}`, "");
  const tmp = `${file}.writing`;
  writeFileSync(tmp, lines.join("\n"), { mode: 0o600 });
  renameSync(tmp, file);
  try {
    chmodSync(file, 0o600);
  } catch {
    // Already private.
  }
}

function dailyBar(candle: unknown): {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
} | null {
  if (!Array.isArray(candle) || candle.length < 5) return null;
  const [time, open, high, low, close, volume] = candle;
  if (
    typeof time !== "string" ||
    typeof open !== "number" ||
    typeof high !== "number" ||
    typeof low !== "number" ||
    typeof close !== "number"
  ) {
    return null;
  }
  return {
    date: time.slice(0, 10),
    open,
    high,
    low,
    close,
    ...(typeof volume === "number" && volume > 0 ? { volume } : {}),
  };
}

/** Calendar days of daily history. 1400 covers a 3.5y backtest window plus warmup. */
const HISTORY_DAYS_MAX = 1400;
const HISTORY_DAYS_MIN = 60;
const HISTORY_DAYS_DEFAULT = 200;

function requestedHistoryDays(url: URL): number {
  const requested = Number(url.searchParams.get("days"));
  if (!Number.isFinite(requested)) return HISTORY_DAYS_DEFAULT;
  return Math.min(HISTORY_DAYS_MAX, Math.max(HISTORY_DAYS_MIN, Math.round(requested)));
}

function istDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function istClockParts(date: Date): { dateKey: string; weekday: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    dateKey: `${read("year")}-${read("month")}-${read("day")}`,
    weekday: read("weekday"),
    minutes: Number(read("hour")) * 60 + Number(read("minute")),
  };
}

/**
 * Exclude today's incomplete intraday candle while NSE is open (09:15–15:35 IST on weekdays).
 * Keeps morning RVOL, EMA 20, and Prime signals anchored to confirmed closed EOD bars while
 * live quotes drive the real-time gap guard and Portfolio P&L.
 */
function historyRange(url: URL, now = new Date()): { fromText: string; toText: string; days: number } {
  const days = requestedHistoryDays(url);
  const clock = istClockParts(now);
  const isWeekday = clock.weekday !== "Sat" && clock.weekday !== "Sun";
  const beforeSettlement = isWeekday && clock.minutes < 15 * 60 + 35;
  const endDate = beforeSettlement ? new Date(now.getTime() - 24 * 60 * 60 * 1000) : now;
  const from = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    fromText: `${istDate(from)} 09:15:00`,
    toText: `${istDate(endDate)} 15:30:00`,
    days,
  };
}

/** Require roughly half the calendar span in trading bars before trusting cache. */
function minBarsForDays(days: number): number {
  return Math.max(60, Math.round(days * 0.5));
}

function effectiveAppOrigin(req: IncomingMessage, env: KiteEnv): string {
  if (env.appOrigin) return env.appOrigin;
  const proto = String(req.headers["x-forwarded-proto"] ?? "http").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "127.0.0.1:8080").split(",")[0].trim();
  return `${proto}://${host}`;
}

export function createKiteHandler(env: KiteEnv) {
  return async function handleKite(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = routePath(url.pathname);
    const configured = Boolean(env.apiKey && env.apiSecret);
    const origin = effectiveAppOrigin(req, env).replace(/\/+$/, "");
    const redirectUrl = env.redirectUrl || `${origin}/api/kite/callback`;

    if (pathname === "/api/kite/status" && req.method === "GET") {
      const { session, expired } = takeSession(req, env);
      sendJson(res, 200, {
        configured,
        connected: Boolean(session),
        expired,
        userName: session?.userName ?? null,
        userId: session?.userId ?? null,
        redirectUrl,
        lastRefreshAt: env.lastRefreshAt,
        expiresAt: session ? new Date(kiteExpiresAt(Date.parse(session.obtainedAt))).toISOString() : null,
      });
      return;
    }

    if (pathname === "/api/kite/credentials" && req.method === "POST") {
      if (!env.envPath) {
        sendJson(res, 409, {
          error: "Set KITE_API_KEY and KITE_API_SECRET as Cloud Run environment variables.",
        });
        return;
      }
      let payload: { apiKey?: unknown; apiSecret?: unknown };
      try {
        payload = JSON.parse(await readBody(req)) as { apiKey?: unknown; apiSecret?: unknown };
      } catch {
        sendJson(res, 400, { error: "Enter both the API key and the API secret." });
        return;
      }
      const apiKey = credentialValue(payload.apiKey);
      const apiSecret = credentialValue(payload.apiSecret);
      if (!apiKey || !apiSecret) {
        sendJson(res, 400, { error: "The key and secret should be the letters and numbers from the Kite developer console." });
        return;
      }
      try {
        writeCredentials(env.envPath, apiKey, apiSecret);
      } catch {
        sendJson(res, 500, { error: "Could not store the Kite key on the server." });
        return;
      }
      env.apiKey = apiKey;
      env.apiSecret = apiSecret;
      process.env.KITE_API_KEY = apiKey;
      process.env.KITE_API_SECRET = apiSecret;
      sendJson(res, 200, { configured: true });
      return;
    }

    if (pathname === "/api/kite/login" && req.method === "GET") {
      if (!configured) {
        sendJson(res, 409, {
          error: "Kite is not configured. Set KITE_API_KEY and KITE_API_SECRET in the server environment.",
        });
        return;
      }
      const login = new URL(KITE_LOGIN);
      login.searchParams.set("v", "3");
      login.searchParams.set("api_key", env.apiKey);
      res.statusCode = 302;
      res.setHeader("location", login.toString());
      res.end();
      return;
    }

    if (pathname === "/api/kite/callback" && req.method === "GET") {
      const requestToken = url.searchParams.get("request_token");
      const status = url.searchParams.get("status");
      if (!configured || status !== "success" || !requestToken) {
        res.statusCode = 302;
        res.setHeader("location", `${origin}/#/settings`);
        res.end();
        return;
      }
      const checksum = createHash("sha256")
        .update(`${env.apiKey}${requestToken}${env.apiSecret}`)
        .digest("hex");
      const tokenResponse = await fetch(`${KITE_API}/session/token`, {
        method: "POST",
        headers: {
          "X-Kite-Version": "3",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          api_key: env.apiKey,
          request_token: requestToken,
          checksum,
        }),
      });
      const payload = (await tokenResponse.json()) as {
        status?: string;
        data?: { access_token?: string; user_id?: string; user_name?: string };
      };
      const accessToken = payload.data?.access_token;
      if (!tokenResponse.ok || payload.status !== "success" || !accessToken) {
        res.statusCode = 302;
        res.setHeader("location", `${origin}/#/settings`);
        res.end();
        return;
      }
      const session: KiteSession = {
        accessToken,
        userId: payload.data?.user_id ?? "",
        userName: payload.data?.user_name ?? payload.data?.user_id ?? "Kite user",
        obtainedAt: new Date().toISOString(),
      };
      const sid = randomBytes(24).toString("hex");
      env.sessions.set(sid, session);
      env.save();
      const sealed = sealSession(session, effectiveSecret(env));
      const flags = cookieFlags(req, env, 86400);
      res.statusCode = 302;
      res.setHeader("set-cookie", [`${COOKIE_SID}=${sid}; ${flags}`, `${COOKIE_ENC}=${sealed}; ${flags}`]);
      res.setHeader("location", `${origin}/#/settings`);
      res.end();
      return;
    }

    if (pathname === "/api/kite/logout" && req.method === "POST") {
      dropSession(req, res, env);
      res.statusCode = 204;
      res.end();
      return;
    }

    const { session, expired } = takeSession(req, env);
    if (!session || !configured) {
      sendJson(res, 401, { error: expired ? "Kite session expired. Connect again." : "Kite is not connected.", expired });
      return;
    }

    if (pathname === "/api/kite/quotes" && req.method === "GET") {
      const symbols = symbolsFrom(url.searchParams);
      if (symbols.length === 0) {
        sendJson(res, 400, { error: "No symbols." });
        return;
      }
      const query = symbols.map((symbol) => `i=${encodeURIComponent(`NSE:${nseTradingSymbol(symbol)}`)}`).join("&");
      kiteLog(`quote request count=${symbols.length}`);
      const quoteResponse = await kiteFetch(`/quote?${query}`, env.apiKey, session.accessToken);
      if (quoteResponse.status === 403) {
        kiteLog("quote response http=403 session rejected");
        dropSession(req, res, env);
        sendJson(res, 401, { error: "Kite session expired. Connect again.", expired: true });
        return;
      }
      const payload = (await quoteResponse.json()) as {
        status?: string;
        message?: string;
        data?: Record<string, { instrument_token?: number; last_price?: number; ohlc?: { close?: number } }>;
      };
      if (!quoteResponse.ok || payload.status !== "success" || !payload.data) {
        kiteLog(`quote response http=${quoteResponse.status} status=${payload.status ?? "none"} message=${payload.message ?? "none"}`);
        sendJson(res, 502, { error: payload.message || "Kite quote request failed." });
        return;
      }
      const quotes = symbols.flatMap((symbol) => {
        const row = payload.data?.[`NSE:${nseTradingSymbol(symbol)}`];
        if (!row || typeof row.last_price !== "number" || typeof row.instrument_token !== "number") return [];
        return [
          {
            symbol,
            lastPrice: row.last_price,
            previousClose: row.ohlc?.close ?? row.last_price,
            instrumentToken: row.instrument_token,
          },
        ];
      });
      const missing = symbols.filter((symbol) => !quotes.some((quote) => quote.symbol === symbol));
      kiteLog(
        `quote response http=${quoteResponse.status} returned=${quotes.length} missing=${missing.length ? missing.join(",") : "none"}`,
      );
      if (quotes.length > 0) {
        env.lastRefreshAt = new Date().toISOString();
        env.save();
      }
      sendJson(res, 200, { quotes, missing, refreshedAt: env.lastRefreshAt });
      return;
    }

    if (pathname === "/api/kite/holdings" && req.method === "GET") {
      kiteLog("holdings request");
      const holdingsResponse = await kiteFetch("/portfolio/holdings", env.apiKey, session.accessToken);
      if (holdingsResponse.status === 403) {
        kiteLog("holdings response http=403 session rejected");
        dropSession(req, res, env);
        sendJson(res, 401, { error: "Kite session expired. Connect again.", expired: true });
        return;
      }
      const payload = (await holdingsResponse.json()) as {
        status?: string;
        message?: string;
        data?: {
          tradingsymbol?: string;
          exchange?: string;
          instrument_token?: number;
          quantity?: number;
          t1_quantity?: number;
          average_price?: number;
          last_price?: number;
        }[];
      };
      if (!holdingsResponse.ok || payload.status !== "success" || !Array.isArray(payload.data)) {
        kiteLog(`holdings response http=${holdingsResponse.status} message=${payload.message ?? "none"}`);
        sendJson(res, 502, { error: payload.message || "Kite holdings request failed." });
        return;
      }
      const rows = payload.data.flatMap((row) => {
        const symbol = (row.tradingsymbol ?? "").toUpperCase();
        const exchange = (row.exchange ?? "").toUpperCase();
        const quantity = (row.quantity ?? 0) + (row.t1_quantity ?? 0);
        if (!/^[A-Z][A-Z0-9&-]{0,24}$/.test(symbol) || !exchange || !(quantity > 0)) return [];
        if (typeof row.average_price !== "number" || typeof row.instrument_token !== "number") return [];
        return [
          {
            symbol,
            exchange,
            quantity,
            t1Quantity: row.t1_quantity ?? 0,
            averagePrice: row.average_price,
            lastPrice: typeof row.last_price === "number" ? row.last_price : row.average_price,
            instrumentToken: row.instrument_token,
          },
        ];
      });
      if (rows.length > 0) {
        const query = rows.map((row) => `i=${encodeURIComponent(`${row.exchange}:${row.symbol}`)}`).join("&");
        const quoteResponse = await kiteFetch(`/quote?${query}`, env.apiKey, session.accessToken);
        kiteLog(`holdings quote http=${quoteResponse.status} count=${rows.length}`);
        if (quoteResponse.ok) {
          const quotePayload = (await quoteResponse.json()) as {
            data?: Record<string, { last_price?: number }>;
          };
          for (const row of rows) {
            const last = quotePayload.data?.[`${row.exchange}:${row.symbol}`]?.last_price;
            if (typeof last === "number") row.lastPrice = last;
          }
        }
      }
      kiteLog(`holdings response http=${holdingsResponse.status} count=${rows.length}`);
      sendJson(res, 200, { holdings: rows });
      return;
    }

    if (pathname === "/api/kite/history" && req.method === "GET") {
      const pairs = (url.searchParams.get("pairs") ?? "")
        .split(",")
        .flatMap((part) => {
          const [symbol, tokenText] = part.split(":");
          const token = Number(tokenText);
          const clean = (symbol ?? "").trim().toUpperCase();
          if (!/^[A-Z][A-Z0-9&-]{0,24}$/.test(clean) || !Number.isInteger(token) || token <= 0) return [];
          return [{ symbol: clean, token }];
        })
        .slice(0, 40);
      if (pairs.length > 0) {
        const histories: Record<string, { date: string; open: number; high: number; low: number; close: number }[]> = {};
        const { fromText, toText, days } = historyRange(url);
        for (const pair of pairs) {
          const historyUrl =
            `/instruments/historical/${pair.token}/day` +
            `?from=${encodeURIComponent(fromText)}&to=${encodeURIComponent(toText)}`;
          const historyResponse = await kiteFetch(historyUrl, env.apiKey, session.accessToken);
          if (historyResponse.status === 403) {
            kiteLog(`history ${pair.symbol} http=403 session rejected`);
            dropSession(req, res, env);
            sendJson(res, 401, { error: "Kite session expired. Connect again.", expired: true });
            return;
          }
          const historyPayload = (await historyResponse.json()) as {
            status?: string;
            message?: string;
            data?: { candles?: unknown[] };
          };
          if (!historyResponse.ok || historyPayload.status === "error") {
            kiteLog(`history ${pair.symbol} http=${historyResponse.status} message=${historyPayload.message ?? "none"}`);
            continue;
          }
          const candles = historyPayload.data?.candles ?? [];
          histories[pair.symbol] = candles.flatMap((candle) => {
            const bar = dailyBar(candle);
            return bar ? [bar] : [];
          });
          await new Promise((resolve) => setTimeout(resolve, 350));
        }
        const candleCounts = Object.entries(histories)
          .map(([symbol, bars]) => `${symbol}:${bars.length}`)
          .join(",");
        kiteLog(`history pairs=${pairs.length} days=${days} candles=${candleCounts || "none"}`);
        saveKiteHistoryCache(histories, days);
        sendJson(res, 200, { histories });
        return;
      }
      const symbols = symbolsFrom(url.searchParams);
      const { fromText, toText, days } = historyRange(url);
      const minBars = minBarsForDays(days);
      const cached = loadKiteHistoryCache();
      const sessionDate = cached ? freshSessionDate(cached) : null;
      const histories: Record<string, { date: string; open: number; high: number; low: number; close: number; volume?: number }[]> = {};
      const missing: string[] = [];
      for (const symbol of symbols) {
        const hit = cached?.histories[symbol];
        if (cachedBarsAreFresh(hit, sessionDate, minBars)) {
          histories[symbol] = hit ?? [];
        } else {
          missing.push(symbol);
        }
      }
      kiteLog(
        `history cache hits=${symbols.length - missing.length} fetch=${missing.length} days=${days} minBars=${minBars} session=${sessionDate ?? "none"}`,
      );
      if (missing.length > 0) {
        const query = missing.map((symbol) => `i=${encodeURIComponent(`NSE:${nseTradingSymbol(symbol)}`)}`).join("&");
        const quoteResponse = await kiteFetch(`/quote?${query}`, env.apiKey, session.accessToken);
        if (quoteResponse.status === 403) {
          kiteLog("history quote http=403 session rejected");
          dropSession(req, res, env);
          sendJson(res, 401, { error: "Kite session expired. Connect again.", expired: true });
          return;
        }
        const quotePayload = (await quoteResponse.json()) as {
          data?: Record<string, { instrument_token?: number }>;
        };
        for (const symbol of missing) {
          const tradingSymbol = nseTradingSymbol(symbol);
          const token = quotePayload.data?.[`NSE:${tradingSymbol}`]?.instrument_token;
          if (!token) {
            kiteLog(`history ${symbol} skipped no instrument token for NSE:${tradingSymbol}`);
            continue;
          }
          const historyUrl =
            `/instruments/historical/${token}/day` +
            `?from=${encodeURIComponent(fromText)}&to=${encodeURIComponent(toText)}`;
          let historyResponse = await kiteFetch(historyUrl, env.apiKey, session.accessToken);
          if (historyResponse.status === 429) {
            kiteLog(`history ${symbol} http=429 retrying`);
            await new Promise((resolve) => setTimeout(resolve, 1500));
            historyResponse = await kiteFetch(historyUrl, env.apiKey, session.accessToken);
          }
          if (historyResponse.status === 403) {
            kiteLog(`history ${symbol} http=403 session rejected`);
            dropSession(req, res, env);
            sendJson(res, 401, { error: "Kite session expired. Connect again.", expired: true });
            return;
          }
          const historyPayload = (await historyResponse.json()) as {
            status?: string;
            message?: string;
            data?: { candles?: unknown[] };
          };
          if (!historyResponse.ok || historyPayload.status === "error") {
            kiteLog(`history ${symbol} skipped http=${historyResponse.status} message=${historyPayload.message ?? "none"}`);
            await new Promise((resolve) => setTimeout(resolve, 380));
            continue;
          }
          histories[symbol] = (historyPayload.data?.candles ?? []).flatMap((candle) => {
            const bar = dailyBar(candle);
            return bar ? [bar] : [];
          });
          await new Promise((resolve) => setTimeout(resolve, 380));
        }
      }

      const candleCounts = Object.entries(histories)
        .map(([symbol, bars]) => `${symbol}:${bars.length}`)
        .join(",");
      kiteLog(`history response symbols=${symbols.length} days=${days} candles=${candleCounts || "none"}`);
      saveKiteHistoryCache(histories, days);
      sendJson(res, 200, { histories });
      return;
    }

    sendJson(res, 404, { error: "Unknown Kite route." });
  };
}

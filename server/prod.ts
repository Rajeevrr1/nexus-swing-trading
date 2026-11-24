import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { createKiteHandler, readCookie, type KiteEnv } from "./kiteHandler";
import { createTelegramHandler, type TelegramEnv } from "./telegramHandler";
import { safeEqual, signDeskToken } from "./sessionCrypto";

const PORT = Number(process.env.PORT) || 8080;
const HOST = "0.0.0.0";
const DIST_DIR = resolve(process.env.DIST_DIR || "dist");
const DESK_PASSWORD = (process.env.DESK_PASSWORD || "").trim();
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  `${process.env.KITE_API_SECRET || ""}:${process.env.KITE_API_KEY || ""}:${DESK_PASSWORD}` ||
  "nexus-cloud-run";
const AUTH_COOKIE = "nexus_auth";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const appOrigin = (process.env.APP_ORIGIN || "").replace(/\/+$/, "");
const kiteEnv: KiteEnv = {
  apiKey: (process.env.KITE_API_KEY || "").trim(),
  apiSecret: (process.env.KITE_API_SECRET || "").trim(),
  envPath: null, // Cloud Run uses environment variables / Secret Manager, never local .env writes.
  appOrigin,
  redirectUrl: (process.env.KITE_REDIRECT_URL || "").trim() || (appOrigin ? `${appOrigin}/api/kite/callback` : ""),
  sessionSecret: SESSION_SECRET,
  sessions: new Map(),
  expiredSids: new Set(),
  lastRefreshAt: null,
  save() {
    // Stateless encrypted HttpOnly cookie persists session across Cloud Run restarts.
  },
};

const telegramEnv: TelegramEnv = {
  botToken: (process.env.TELEGRAM_BOT_TOKEN || "").trim(),
  chatId: (process.env.TELEGRAM_CHAT_ID || "").trim(),
  envPath: null,
};

const handleKite = createKiteHandler(kiteEnv);
const handleTelegram = createTelegramHandler(telegramEnv);

function isHttps(req: IncomingMessage): boolean {
  return String(req.headers["x-forwarded-proto"] ?? "").toLowerCase() === "https" || appOrigin.startsWith("https://");
}

function isAuthorized(req: IncomingMessage): boolean {
  if (!DESK_PASSWORD) return true;
  const cookie = readCookie(req, AUTH_COOKIE);
  if (!cookie) return false;
  const expected = signDeskToken(DESK_PASSWORD, SESSION_SECRET);
  return safeEqual(cookie, expected);
}

async function readSmallBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.from(chunk);
    size += buf.length;
    if (size > 4_096) throw new Error("Payload too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendLockScreen(res: ServerResponse) {
  res.statusCode = 401;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>NEXUS Swing Desk · Sign in</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1117;color:#e6edf3;font:15px/1.5 system-ui,-apple-system,sans-serif}
    form{width:min(340px,90vw);padding:28px;border-radius:16px;background:#111923;border:1px solid #223041;box-shadow:0 20px 50px rgba(0,0,0,.45)}
    h1{margin:0 0 6px;font-size:20px;letter-spacing:-.01em}
    p{margin:0 0 18px;color:#8b9bb0;font-size:13px}
    input{width:100%;box-sizing:border-box;padding:11px 13px;border-radius:10px;border:1px solid #2c3e54;background:#0b1117;color:#e6edf3;font-size:15px;margin-bottom:12px}
    button{width:100%;padding:11px;border:0;border-radius:10px;background:#10b981;color:#052e16;font-weight:700;font-size:15px;cursor:pointer}
    button:hover{background:#34d399}
    .err{color:#f87171;font-size:13px;min-height:18px;margin-top:10px}
  </style>
</head>
<body>
  <form id="f">
    <h1>NEXUS Swing Desk</h1>
    <p>Enter your desk PIN to unlock live NSE signals.</p>
    <input id="p" type="password" placeholder="Desk PIN / Password" autocomplete="current-password" autofocus required />
    <button type="submit">Unlock</button>
    <div id="e" class="err"></div>
  </form>
  <script>
    document.getElementById('f').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = document.getElementById('e');
      err.textContent = '';
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: document.getElementById('p').value })
      });
      if (res.ok) { location.reload(); return; }
      err.textContent = 'Invalid PIN. Try again.';
    });
  </script>
</body>
</html>`);
}

function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const candidate = resolve(DIST_DIR, `.${cleanPath}`);
  const insideDist = candidate === DIST_DIR || candidate.startsWith(`${DIST_DIR}\\`) || candidate.startsWith(`${DIST_DIR}/`);
  let filePath = insideDist && existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(DIST_DIR, "index.html");
  if (!existsSync(filePath)) {
    res.statusCode = 404;
    res.end("Build output missing. Run npm run build first.");
    return;
  }
  const ext = extname(filePath).toLowerCase();
  res.statusCode = 200;
  res.setHeader("content-type", MIME[ext] || "application/octet-stream");
  if (cleanPath.startsWith("/assets/")) {
    res.setHeader("cache-control", "public, max-age=31536000, immutable");
  } else {
    res.setHeader("cache-control", "no-cache");
  }
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  res.end(readFileSync(filePath));
}

async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const pathname = url.pathname;

  if (pathname === "/healthz") {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (pathname === "/api/auth/login" && req.method === "POST") {
    if (!DESK_PASSWORD) {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    let payload: { password?: unknown };
    try {
      payload = JSON.parse(await readSmallBody(req)) as { password?: unknown };
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Invalid request" }));
      return;
    }
    const candidate = typeof payload.password === "string" ? payload.password : "";
    if (!safeEqual(candidate, DESK_PASSWORD)) {
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "Invalid PIN" }));
      return;
    }
    const token = signDeskToken(DESK_PASSWORD, SESSION_SECRET);
    const secure = isHttps(req) ? "; Secure" : "";
    res.statusCode = 200;
    res.setHeader("set-cookie", `${AUTH_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}`);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (pathname === "/api/auth/logout" && req.method === "POST") {
    const secure = isHttps(req) ? "; Secure" : "";
    res.statusCode = 204;
    res.setHeader("set-cookie", `${AUTH_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
    res.end();
    return;
  }

  // Always allow Zerodha Kite OAuth callback through so redirect succeeds cleanly.
  const isKiteCallback = pathname === "/api/kite/callback" || pathname === "/api/v1/broker/kite/callback";
  if (!isKiteCallback && !isAuthorized(req)) {
    if (pathname.startsWith("/api/")) {
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "Desk is locked. Unlock with your PIN." }));
      return;
    }
    sendLockScreen(res);
    return;
  }

  if (pathname.startsWith("/api/kite") || pathname.startsWith("/api/v1/broker/kite")) {
    await handleKite(req, res);
    return;
  }
  if (pathname.startsWith("/api/telegram")) {
    await handleTelegram(req, res);
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(req, res, pathname);
    return;
  }
  res.statusCode = 404;
  res.end("Not found");
}

const server = createServer((req, res) => {
  void route(req, res).catch((err) => {
    console.error("[server] unhandled error:", err instanceof Error ? err.message : err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "Internal server error." }));
    }
  });
});

server.listen(PORT, HOST, () => {
  console.info(
    `[nexus] production server listening on http://${HOST}:${PORT} (kite=${kiteEnv.apiKey ? "configured" : "missing"}, pin=${DESK_PASSWORD ? "enabled" : "off"})`,
  );
});

process.on("SIGTERM", () => {
  console.info("[nexus] SIGTERM received, shutting down gracefully...");
  server.close(() => process.exit(0));
});

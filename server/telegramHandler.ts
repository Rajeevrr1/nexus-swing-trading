import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";

const TELEGRAM_API = "https://api.telegram.org";

export interface TelegramEnv {
  botToken: string;
  chatId: string;
  envPath: string | null;
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.from(chunk);
    size += buf.length;
    if (size > 32_000) throw new Error("Payload too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function botTokenValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(trimmed)) return null;
  return trimmed;
}

function chatIdValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^-?\d{5,20}$/.test(trimmed)) return null;
  return trimmed;
}

function readTelegramFromFile(file: string | null): { botToken: string; chatId: string } {
  if (!file) return { botToken: "", chatId: "" };
  try {
    const text = readFileSync(file, "utf8");
    const botToken = text.match(/^TELEGRAM_BOT_TOKEN=(.+)$/m)?.[1]?.trim() ?? "";
    const chatId = text.match(/^TELEGRAM_CHAT_ID=(.+)$/m)?.[1]?.trim() ?? "";
    return { botToken, chatId };
  } catch {
    return { botToken: "", chatId: "" };
  }
}

function writeTelegramCredentials(file: string, botToken: string, chatId: string) {
  const existing = readTelegramFromFile(file);
  const token = botToken || existing.botToken;
  const chat = chatId || existing.chatId;
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    text = "";
  }
  const lines = text
    .split(/\r?\n/)
    .filter((line) => !/^TELEGRAM_BOT_TOKEN=/.test(line) && !/^TELEGRAM_CHAT_ID=/.test(line));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (token) lines.push(`TELEGRAM_BOT_TOKEN=${token}`);
  if (chat) lines.push(`TELEGRAM_CHAT_ID=${chat}`, "");
  const tmp = `${file}.writing`;
  writeFileSync(tmp, lines.join("\n"), { mode: 0o600 });
  renameSync(tmp, file);
  try {
    chmodSync(file, 0o600);
  } catch {
    // File already private.
  }
}

function maskChatId(chatId: string): string {
  if (chatId.length <= 4) return "••••";
  return `••••${chatId.slice(-4)}`;
}

export async function telegramSend(env: TelegramEnv, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!env.botToken || !env.chatId) return { ok: false, error: "Telegram is not configured." };
  const url = `${TELEGRAM_API}/bot${env.botToken}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: env.chatId, text, disable_web_page_preview: true }),
  });
  const body = (await response.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!response.ok || body.ok === false) {
    return { ok: false, error: body.description || "Telegram rejected the message." };
  }
  return { ok: true };
}

const TYPE_LABEL: Record<string, string> = {
  exit: "Exit Alert",
  strong: "Strong Buy Alert",
  book: "Book Profit Alert",
  caution: "Caution Alert",
  prime: "Prime Trigger",
  standard: "Std Trigger",
  review: "Review Alert",
};

function formatPayload(alert: { type: string; symbol: string; name: string; message: string; price?: string | null }) {
  if (alert.type === "prime" || alert.type === "standard") {
    return ["NEXUS NSE Swing Desk", "", alert.message].join("\n");
  }
  const label = TYPE_LABEL[alert.type] ?? "Desk Alert";
  const lines = [
    "NEXUS NSE Swing Desk",
    "",
    `Stock: ${alert.symbol}${alert.name !== alert.symbol ? ` (${alert.name})` : ""}`,
    `Type: ${label}`,
  ];
  if (alert.price) lines.push(`Price: ${alert.price}`);
  lines.push(`Reason: ${alert.message}`);
  return lines.join("\n");
}

export function createTelegramHandler(env: TelegramEnv) {
  return async function handleTelegram(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = url.pathname;

    if (pathname === "/api/telegram/status" && req.method === "GET") {
      const configured = Boolean(env.botToken && env.chatId);
      sendJson(res, 200, {
        configured,
        chatId: env.chatId ? maskChatId(env.chatId) : null,
        tokenSet: Boolean(env.botToken),
        chatIdSet: Boolean(env.chatId),
      });
      return;
    }

    if (pathname === "/api/telegram/credentials" && req.method === "POST") {
      let payload: { botToken?: unknown; chatId?: unknown };
      try {
        payload = JSON.parse(await readBody(req)) as { botToken?: unknown; chatId?: unknown };
      } catch {
        sendJson(res, 400, { error: "Enter the bot token and chat ID." });
        return;
      }
      const fileValues = readTelegramFromFile(env.envPath);
      const nextToken =
        typeof payload.botToken === "string" && payload.botToken.trim()
          ? botTokenValue(payload.botToken)
          : env.botToken || fileValues.botToken || null;
      const nextChatId =
        typeof payload.chatId === "string" && payload.chatId.trim()
          ? chatIdValue(payload.chatId)
          : env.chatId || fileValues.chatId || null;
      if (typeof payload.botToken === "string" && payload.botToken.trim() && !nextToken) {
        sendJson(res, 400, { error: "The bot token should look like 123456789:ABC… from BotFather." });
        return;
      }
      if (typeof payload.chatId === "string" && payload.chatId.trim() && !nextChatId) {
        sendJson(res, 400, { error: "Use the numeric chat ID from getUpdates." });
        return;
      }
      if (
        !nextChatId &&
        !nextToken &&
        !(typeof payload.chatId === "string" && payload.chatId.trim()) &&
        !(typeof payload.botToken === "string" && payload.botToken.trim())
      ) {
        sendJson(res, 400, { error: "Enter a bot token or chat ID to save." });
        return;
      }
      const mergedToken = nextToken ?? env.botToken ?? fileValues.botToken;
      const mergedChat = nextChatId ?? env.chatId ?? fileValues.chatId;
      if (env.envPath) {
        try {
          writeTelegramCredentials(
            env.envPath,
            typeof payload.botToken === "string" && payload.botToken.trim() ? (nextToken ?? "") : "",
            typeof payload.chatId === "string" && payload.chatId.trim() ? (nextChatId ?? "") : "",
          );
        } catch {
          sendJson(res, 500, { error: "Could not store Telegram credentials on the server." });
          return;
        }
      }
      if (mergedToken) env.botToken = mergedToken;
      if (mergedChat) env.chatId = mergedChat;
      if (mergedToken) process.env.TELEGRAM_BOT_TOKEN = mergedToken;
      if (mergedChat) process.env.TELEGRAM_CHAT_ID = mergedChat;
      const configured = Boolean(mergedToken && mergedChat);
      sendJson(res, 200, {
        configured,
        chatId: mergedChat ? maskChatId(mergedChat) : null,
        tokenSet: Boolean(mergedToken),
        chatIdSet: Boolean(mergedChat),
      });
      return;
    }

    if (pathname === "/api/telegram/test" && req.method === "POST") {
      if (!env.botToken || !env.chatId) {
        sendJson(res, 409, { error: "Save the bot token and chat ID first." });
        return;
      }
      const result = await telegramSend(
        env,
        "NEXUS test message\n\nTelegram alerts are configured. You will receive exit, strong buy, book profit, and caution alerts from the desk.",
      );
      if (!result.ok) {
        sendJson(res, 502, { error: result.error });
        return;
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === "/api/telegram/notify" && req.method === "POST") {
      if (!env.botToken || !env.chatId) {
        sendJson(res, 200, { skipped: true, reason: "not_configured" });
        return;
      }
      let payload: { alerts?: unknown };
      try {
        payload = JSON.parse(await readBody(req)) as { alerts?: unknown };
      } catch {
        sendJson(res, 400, { error: "Invalid alert payload." });
        return;
      }
      const rows = Array.isArray(payload.alerts) ? payload.alerts : [];
      const sent: string[] = [];
      const failed: string[] = [];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const alert = row as { id?: string; type?: string; symbol?: string; name?: string; message?: string; price?: string };
        if (!alert.type || !alert.symbol || !alert.message) continue;
        const result = await telegramSend(
          env,
          formatPayload({
            type: alert.type,
            symbol: alert.symbol,
            name: typeof alert.name === "string" ? alert.name : alert.symbol,
            message: alert.message,
            price: typeof alert.price === "string" ? alert.price : null,
          }),
        );
        if (result.ok) sent.push(alert.id ?? alert.symbol);
        else failed.push(result.error);
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      if (failed.length > 0 && sent.length === 0) {
        sendJson(res, 502, { error: failed[0], sent, failed: failed.length });
        return;
      }
      sendJson(res, 200, { sent: sent.length, failed: failed.length });
      return;
    }

    sendJson(res, 404, { error: "Unknown Telegram route." });
  };
}

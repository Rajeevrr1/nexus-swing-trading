import { formatInr } from "../analysis";
import type { LiveQuote } from "../market/kiteClient";
import type { DeskAlert } from "./types";

export interface TelegramStatus {
  configured: boolean;
  chatId: string | null;
  tokenSet?: boolean;
  chatIdSet?: boolean;
}

const CHAT_DRAFT_KEY = "nexus-telegram-chat-id";
const TOKEN_DRAFT_KEY = "nexus-telegram-bot-token";

export function loadTelegramDraft(): { chatId: string; botToken: string } {
  try {
    return {
      chatId: window.sessionStorage.getItem(CHAT_DRAFT_KEY) ?? "",
      botToken: window.sessionStorage.getItem(TOKEN_DRAFT_KEY) ?? "",
    };
  } catch {
    return { chatId: "", botToken: "" };
  }
}

export function saveTelegramDraft(chatId: string, botToken: string) {
  try {
    if (chatId) window.sessionStorage.setItem(CHAT_DRAFT_KEY, chatId);
    else window.sessionStorage.removeItem(CHAT_DRAFT_KEY);
    if (botToken) window.sessionStorage.setItem(TOKEN_DRAFT_KEY, botToken);
    else window.sessionStorage.removeItem(TOKEN_DRAFT_KEY);
  } catch {
    // Drafts are optional.
  }
}

export async function fetchTelegramStatus(): Promise<TelegramStatus> {
  const response = await fetch("/api/telegram/status");
  if (!response.ok) return { configured: false, chatId: null };
  return (await response.json()) as TelegramStatus;
}

export async function saveTelegramCredentials(botToken: string, chatId: string): Promise<void> {
  const payload: { botToken?: string; chatId?: string } = {};
  if (botToken.trim()) payload.botToken = botToken.trim();
  if (chatId.trim()) payload.chatId = chatId.trim();
  const response = await fetch("/api/telegram/credentials", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(result.error || "Could not save Telegram credentials.");
}

export async function testTelegram(): Promise<void> {
  const response = await fetch("/api/telegram/test", { method: "POST" });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error || "Test message failed.");
}

/** Push new desk alerts to Telegram. The bot token never leaves the server. */
export async function notifyTelegramAlerts(
  alerts: readonly DeskAlert[],
  quotes: Record<string, LiveQuote>,
): Promise<void> {
  if (alerts.length === 0) return;
  const response = await fetch("/api/telegram/notify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      alerts: alerts.map((alert) => ({
        id: alert.id,
        type: alert.type,
        symbol: alert.symbol,
        name: alert.name,
        message: alert.message,
        price: priceFor(alert.symbol, quotes, alert.message),
      })),
    }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    console.warn("[telegram]", body.error || "notify failed");
  }
}

function priceFor(symbol: string, quotes: Record<string, LiveQuote>, message: string): string | null {
  const quote = quotes[symbol];
  if (quote?.lastPrice != null) return formatInr(quote.lastPrice);
  const match = message.match(/₹[\d,]+(?:\.\d+)?/);
  return match ? match[0] : null;
}

import type { Plugin } from "vite";
import { loadEnv } from "vite";
import { createTelegramHandler, type TelegramEnv } from "./telegramHandler";

export type { TelegramEnv };
export { telegramSend } from "./telegramHandler";

export function telegramPlugin(): Plugin {
  return {
    name: "telegram-alerts",
    configureServer(server) {
      const envFile = loadEnv(server.config.mode, server.config.root, "");
      const env: TelegramEnv = {
        botToken: envFile.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "",
        chatId: envFile.TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID || "",
        envPath: `${server.config.root}/.env`,
      };
      const handleTelegram = createTelegramHandler(env);
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0] ?? "";
        if (!path.startsWith("/api/telegram")) {
          next();
          return;
        }
        void handleTelegram(req, res).catch(() => {
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "Telegram request failed." }));
          }
        });
      });
    },
  };
}

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { loadEnv } from "vite";
import {
  createKiteHandler,
  KITE_REDIRECT_URL,
  loadKiteStore,
  writeKiteStore,
  type KiteEnv,
  type SessionStore,
} from "./kiteHandler";

export { KITE_REDIRECT_URL };

const LOCAL_APP_ORIGIN = "http://127.0.0.1:5173";

export function kitePlugin(): Plugin {
  return {
    name: "kite-connect",
    configureServer(server) {
      const envFile = loadEnv(server.config.mode, server.config.root, "");
      const storeFile = `${server.config.root}/.kite-session.json`;
      const loaded = loadKiteStore(storeFile);
      const sessions = new Map(Object.entries(loaded.store.sessions));
      const env: KiteEnv = {
        apiKey: envFile.KITE_API_KEY || process.env.KITE_API_KEY || "",
        apiSecret: envFile.KITE_API_SECRET || process.env.KITE_API_SECRET || "",
        envPath: `${server.config.root}/.env`,
        appOrigin: envFile.APP_ORIGIN || process.env.APP_ORIGIN || LOCAL_APP_ORIGIN,
        redirectUrl: envFile.KITE_REDIRECT_URL || process.env.KITE_REDIRECT_URL || KITE_REDIRECT_URL,
        sessionSecret: envFile.SESSION_SECRET || process.env.SESSION_SECRET || "",
        sessions,
        expiredSids: loaded.expiredSids,
        lastRefreshAt: loaded.store.lastRefreshAt,
        save() {
          const next: SessionStore = { lastRefreshAt: env.lastRefreshAt, sessions: {} };
          for (const [sid, session] of env.sessions) next.sessions[sid] = session;
          try {
            writeKiteStore(storeFile, next);
          } catch {
            server.config.logger.error("Could not store the Kite session.");
          }
        },
      };
      env.save();
      const handleKite = createKiteHandler(env);
      const onRequest = (req: IncomingMessage, res: ServerResponse) => {
        void handleKite(req, res).catch(() => {
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "Kite request failed." }));
          }
        });
      };
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0] ?? "";
        if (!path.startsWith("/api/kite") && !path.startsWith("/api/v1/broker/kite")) {
          next();
          return;
        }
        onRequest(req, res);
      });
      const broker = createServer(onRequest);
      broker.on("error", (error: NodeJS.ErrnoException) => {
        const message =
          error.code === "EADDRINUSE"
            ? "Port 8000 is already in use, so the Kite callback cannot listen there."
            : "Kite callback server failed to start.";
        server.config.logger.error(message);
      });
      broker.listen(8000, "127.0.0.1");
      server.httpServer?.on("close", () => broker.close());
    },
  };
}

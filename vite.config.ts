import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { kitePlugin } from "./server/kite";
import { telegramPlugin } from "./server/telegram";

export default defineConfig({
  plugins: [react(), kitePlugin(), telegramPlugin()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});

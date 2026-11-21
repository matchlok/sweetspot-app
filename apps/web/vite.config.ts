import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// In dev, /api goes to the Hono server (`pnpm --filter @sweetspot/api dev`, port 8787).
export default defineConfig({
  // vitest bundles its own vite 5, so the vite 6 plugin type needs a cast.
  plugins: [react() as never],
  test: { environment: "jsdom", restoreMocks: true },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8787" },
    fs: { allow: ["../.."] },
  },
});

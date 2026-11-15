import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In dev, /api goes to the Hono server (`pnpm --filter @sweetspot/api dev`, port 8787).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8787" },
    fs: { allow: ["../.."] },
  },
});

import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  build: {
    manifest: true,
  },
  server: {
    strictPort: true,
    host: "127.0.0.1",
  },
  test: {
    // Behaviour tests render real components; the pure-logic and source-contract
    // suites run fine under jsdom too, so one environment covers the repository.
    environment: "jsdom",
    setupFiles: ["./src/testSetup.ts"],
  },
});

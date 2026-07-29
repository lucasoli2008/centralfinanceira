import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // `server-only` é fornecido pelo bundler do Next.js; nos testes usamos um stub.
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.spec.{ts,tsx}"],
    exclude: ["tests/e2e/**"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Testes de componente declaram jsdom por arquivo: // @vitest-environment jsdom
    setupFiles: ["tests/setup.ts"],
  },
});

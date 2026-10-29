import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    include: [
      "tests/integration/**/*.spec.ts",
      "tests/integration/**/*.test.ts",
    ],
    testTimeout: 60000,
    hookTimeout: 60000,
    env: {
      NODE_ENV: "test",
      HESBA_SESSION_SECRET: "hesba-test-session-secret-at-least-16-chars",
      HESBA_CRON_SECRET: "hesba-test-cron-secret",
      HESBA_APP_ORIGIN: "http://localhost:3000",
      HESBA_DATABASE_URL:
        process.env.HESBA_DATABASE_URL ??
        "postgres://hesba_app:change-me-local@localhost:5434/hesba",
      HESBA_DIRECT_URL:
        process.env.HESBA_DIRECT_URL ??
        "postgres://hesba_migrator:change-me-local@localhost:5434/hesba",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "server-only": path.resolve(import.meta.dirname, "./tests/empty-shim.ts"),
    },
  },
});

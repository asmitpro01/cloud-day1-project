import path from "node:path";
import { defineConfig } from "vitest/config";

try {
  process.loadEnvFile(".env");
} catch {
  // CI provides TEST_DATABASE_URL directly.
}

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/app_test";

/** Integration tests run against a real, disposable Postgres database (TEST_DATABASE_URL). */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "test/server-only-stub.ts"),
    },
  },
  test: {
    include: ["src/**/*.int.test.ts"],
    environment: "node",
    globalSetup: ["./test/int-global-setup.ts"],
    // Tests share one database, so run files one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    env: {
      NODE_ENV: "test",
      TEST_DATABASE_URL: testDatabaseUrl,
      DATABASE_URL: testDatabaseUrl,
      DATABASE_URL_UNPOOLED: testDatabaseUrl,
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      BETTER_AUTH_SECRET: "integration-test-secret-integration-test-secret",
      EMAIL_PROVIDER: "console",
      EMAIL_FROM: "Kit Tests <tests@example.com>",
      OTP_PROVIDER: "console",
      PAYMENTS_PROVIDER: "fake",
    },
  },
});

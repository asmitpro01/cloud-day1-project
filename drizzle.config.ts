import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside Next.js, so load .env ourselves. Only `studio` and `push` need a URL;
// migrations are applied by `pnpm db:migrate` (scripts/migrate.ts) with the validated env.
try {
  process.loadEnvFile(".env");
} catch {
  // No .env file: rely on the shell environment.
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "postgres://localhost:5432/app",
  },
  strict: true,
  verbose: true,
});

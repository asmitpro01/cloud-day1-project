import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** Recreates the test database schema from the committed migrations before the run. */
export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  // Guard against wiping a real database by accident.
  if (!/test/i.test(new URL(url).pathname)) {
    throw new Error(
      `Refusing to reset ${new URL(url).pathname}: TEST_DATABASE_URL must point to a database with "test" in its name`,
    );
  }
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await client.unsafe(
      "drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;",
    );
    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  } finally {
    await client.end();
  }
}

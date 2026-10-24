import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { serverEnv } from "@/env/server";

/** Applies pending SQL migrations from ./drizzle using the direct (unpooled) connection. */
export async function runMigrations(): Promise<void> {
  const client = postgres(serverEnv().databaseUrlUnpooled, { max: 1, onnotice: () => undefined });
  try {
    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => {
      console.log("✓ Database migrated");
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error("✗ Migration failed:", error);
      process.exit(1);
    });
}

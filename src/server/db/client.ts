import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { serverEnv } from "@/env/server";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
/** A transaction handle; services that must run inside a caller's transaction take this. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

declare global {
  // Reused across hot reloads in development so we don't leak connections.
  var __kitDb: Db | undefined;
}

function createDb(): Db {
  const env = serverEnv();
  const client = postgres(env.databaseUrl, {
    // Neon and Supabase poolers run PgBouncer in transaction mode, which can't use prepared statements.
    prepare: false,
    max: env.isProduction ? 5 : 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return drizzle(client, { schema });
}

/** The shared Drizzle client. Created lazily so builds and tests don't connect on import. */
export function getDb(): Db {
  globalThis.__kitDb ??= createDb();
  return globalThis.__kitDb;
}

export { schema };

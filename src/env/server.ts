import "server-only";
import { parseServerEnv, type ServerEnv } from "./schema";

let cached: ServerEnv | undefined;

/**
 * Validated server environment. Parsed on first use and at boot (see
 * `src/instrumentation.ts`), so a misconfigured deploy fails fast with a
 * readable error instead of at the first request that needs a missing key.
 */
export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

export type { ServerEnv } from "./schema";

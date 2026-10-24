/**
 * Runs once when the server boots. Validating env here makes a misconfigured
 * deploy fail immediately with a readable list of problems.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { serverEnv } = await import("@/env/server");
    serverEnv();
  }
}

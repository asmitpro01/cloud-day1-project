import { runMigrations } from "./migrate";
import { syncPlans } from "./sync-plans";

/**
 * One-command setup: validates env, migrates the database and syncs plans to Razorpay.
 * Pass --seed to load demo data (development databases only).
 */
async function main(): Promise<void> {
  const { serverEnv } = await import("@/env/server");
  const env = serverEnv();
  console.log(
    `• Environment OK (${env.nodeEnv}); OTP: ${env.otp.provider}, email: ${env.email.provider}, payments: ${env.payments.provider}`,
  );

  await runMigrations();
  console.log("✓ Database migrated");

  await syncPlans();

  if (process.argv.includes("--seed")) {
    const { seed } = await import("./seed");
    await seed();
  }

  console.log(`\nAll set. Start the app with \`pnpm dev\` and open ${env.appUrl}`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("\n✗ Bootstrap failed:\n", error instanceof Error ? error.message : error);
    process.exit(1);
  });

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Fails if any server secret ends up in the browser bundle. Run after `pnpm build`:
 * scans every file under .next/static for the values of secret env vars and for
 * strings that only server code should contain.
 */
const SECRET_ENV_VARS = [
  "BETTER_AUTH_SECRET",
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "GOOGLE_CLIENT_SECRET",
  "MSG91_AUTH_KEY",
  "TWILIO_AUTH_TOKEN",
  "RESEND_API_KEY",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
];

const SERVER_ONLY_MARKERS = [
  "fake_key_secret_for_tests_only",
  "fake_webhook_secret_for_tests_only",
  "postgres://",
  "api.razorpay.com/v1",
  "control.msg91.com",
];

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory() ? listFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
    ),
  );
  return files.flat();
}

async function main(): Promise<void> {
  const staticDir = path.join(process.cwd(), ".next", "static");
  const files = await listFiles(staticDir).catch(() => {
    throw new Error("No .next/static directory. Run `pnpm build` first.");
  });

  const needles = [
    ...SECRET_ENV_VARS.flatMap((name) => {
      const value = process.env[name];
      return value && value.length >= 8 ? [{ label: `value of ${name}`, value }] : [];
    }),
    ...SERVER_ONLY_MARKERS.map((marker) => ({ label: `"${marker}"`, value: marker })),
  ];

  const leaks: string[] = [];
  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const needle of needles) {
      if (content.includes(needle.value)) leaks.push(`${path.relative(process.cwd(), file)} contains ${needle.label}`);
    }
  }

  if (leaks.length > 0) {
    console.error(`✗ Server-only data found in the client bundle:\n  - ${leaks.join("\n  - ")}`);
    process.exit(1);
  }
  console.log(`✓ No secrets in ${files.length} client bundle files (checked ${needles.length} patterns)`);
}

main().catch((error: unknown) => {
  console.error("✗", error instanceof Error ? error.message : error);
  process.exit(1);
});

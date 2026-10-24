import { z } from "zod";

// Next.js inlines NEXT_PUBLIC_* at build time only when they are referenced
// literally, so each variable is read by name here.
const schema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
  NEXT_PUBLIC_PREORDER_URL: z.preprocess((value) => (value === "" ? undefined : value), z.url().optional()),
});

const parsed = schema.parse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_PREORDER_URL: process.env.NEXT_PUBLIC_PREORDER_URL,
});

/** Browser-safe configuration. Never put secrets in NEXT_PUBLIC_* variables. */
export const clientEnv = {
  appUrl: parsed.NEXT_PUBLIC_APP_URL.replace(/\/+$/, ""),
  preorderUrl: parsed.NEXT_PUBLIC_PREORDER_URL ?? null,
} as const;

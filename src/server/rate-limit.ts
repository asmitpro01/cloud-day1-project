import "server-only";
import { lt, sql } from "drizzle-orm";
import { serverEnv } from "@/env/server";
import { RateLimitError } from "@/lib/errors";
import { getDb } from "./db/client";
import { rateLimits } from "./db/schema";

export type RateLimitRule = { limit: number; windowSeconds: number };
export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number };

/** Central list of limits so they're easy to review and tune. */
export const RATE_LIMITS = {
  waitlistPerIp: { limit: 5, windowSeconds: 60 * 60 },
  otpResendCooldown: { limit: 1, windowSeconds: 30 },
  otpSendPerPhone: { limit: 5, windowSeconds: 60 * 60 },
  otpSendPerIp: { limit: 20, windowSeconds: 60 * 60 },
  otpVerifyPerPhone: { limit: 10, windowSeconds: 15 * 60 },
  otpVerifyPerIp: { limit: 30, windowSeconds: 15 * 60 },
  signInPerIp: { limit: 20, windowSeconds: 5 * 60 },
  signInPerEmail: { limit: 8, windowSeconds: 15 * 60 },
  signUpPerIp: { limit: 10, windowSeconds: 60 * 60 },
  emailLinksPerIp: { limit: 10, windowSeconds: 60 * 60 },
  checkoutPerUser: { limit: 20, windowSeconds: 60 * 60 },
} satisfies Record<string, RateLimitRule>;

/**
 * Counts a hit against `key` in a fixed window and reports whether it is allowed.
 * A single atomic upsert, so concurrent requests can't slip past the limit.
 */
export async function hitRateLimit(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
  const windowExpiry = sql`now() + make_interval(secs => ${rule.windowSeconds})`;
  const expired = sql`${rateLimits.expiresAt} <= now()`;

  const [row] = await getDb()
    .insert(rateLimits)
    .values({ key, count: 1, windowStart: sql`now()`, expiresAt: windowExpiry })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${expired} THEN 1 ELSE ${rateLimits.count} + 1 END`,
        windowStart: sql`CASE WHEN ${expired} THEN now() ELSE ${rateLimits.windowStart} END`,
        expiresAt: sql`CASE WHEN ${expired} THEN ${windowExpiry} ELSE ${rateLimits.expiresAt} END`,
      },
    })
    .returning({ count: rateLimits.count, expiresAt: rateLimits.expiresAt });

  if (!row) throw new Error("Rate limit upsert returned no row");

  // Opportunistic cleanup keeps the table small without a cron job.
  if (Math.random() < 0.01) {
    void getDb()
      .delete(rateLimits)
      .where(lt(rateLimits.expiresAt, sql`now() - interval '1 day'`))
      .catch(() => undefined);
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((row.expiresAt.getTime() - Date.now()) / 1000));
  return {
    allowed: row.count <= rule.limit,
    remaining: Math.max(0, rule.limit - row.count),
    retryAfterSeconds,
  };
}

/** Like `hitRateLimit`, but throws `RateLimitError` when the limit is exceeded. */
export async function enforceRateLimit(key: string, rule: RateLimitRule, message?: string): Promise<void> {
  const result = await hitRateLimit(key, rule);
  if (!result.allowed) throw new RateLimitError(result.retryAfterSeconds, message);
}

/**
 * The client IP from the configured proxy header (first hop of `x-forwarded-for` by default).
 * Only trust a header your host sets: Vercel sets x-forwarded-for; behind Cloudflare use cf-connecting-ip.
 */
export function getClientIp(headers: Headers): string {
  const value = headers.get(serverEnv().trustedIpHeader);
  const first = value?.split(",")[0]?.trim();
  return first || "unknown";
}

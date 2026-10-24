import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { RateLimitError } from "@/lib/errors";
import { enforceRateLimit, getClientIp, hitRateLimit } from "./rate-limit";

describe("hitRateLimit (Postgres)", () => {
  it("allows exactly `limit` hits when requests race", async () => {
    const key = `test:race:${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 25 }, () => hitRateLimit(key, { limit: 5, windowSeconds: 60 })),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(5);
    expect(results.every((result) => result.retryAfterSeconds > 0)).toBe(true);
  });

  it("starts a new window after expiry", async () => {
    const key = `test:window:${randomUUID()}`;
    const rule = { limit: 1, windowSeconds: 1 };
    expect((await hitRateLimit(key, rule)).allowed).toBe(true);
    expect((await hitRateLimit(key, rule)).allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect((await hitRateLimit(key, rule)).allowed).toBe(true);
  });

  it("enforceRateLimit throws RateLimitError with retry-after", async () => {
    const key = `test:enforce:${randomUUID()}`;
    await enforceRateLimit(key, { limit: 1, windowSeconds: 30 });
    const error = await enforceRateLimit(key, { limit: 1, windowSeconds: 30 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error instanceof RateLimitError && error.retryAfterSeconds).toBeGreaterThan(25);
  });
});

describe("getClientIp", () => {
  it("takes the first hop of x-forwarded-for", () => {
    expect(getClientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(getClientIp(new Headers())).toBe("unknown");
  });
});

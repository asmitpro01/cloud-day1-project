import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export function hmacSha256Hex(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

/** Constant-time comparison of a computed hex digest with an untrusted one. */
export function signaturesMatch(expectedHex: string, receivedHex: string | null | undefined): boolean {
  if (!receivedHex || !/^[0-9a-f]+$/i.test(receivedHex)) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const received = Buffer.from(receivedHex, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

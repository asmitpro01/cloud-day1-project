import "server-only";
import type { z } from "zod";
import { AppError } from "@/lib/errors";
import { razorpayErrorSchema } from "./schemas";

const API_BASE = "https://api.razorpay.com/v1";

export class RazorpayApiError extends AppError {
  readonly status: number;
  readonly razorpayCode: string | undefined;

  constructor(status: number, message: string, razorpayCode?: string) {
    super("PAYMENT_PROVIDER_ERROR", message);
    this.status = status;
    this.razorpayCode = razorpayCode;
  }
}

export type RazorpayCredentials = { keyId: string; keySecret: string };

/** Minimal typed Razorpay REST client: Basic auth, JSON, timeouts and zod-validated responses. */
export function createRazorpayClient(credentials: RazorpayCredentials, fetchImpl: typeof fetch = fetch) {
  const authorization = `Basic ${Buffer.from(`${credentials.keyId}:${credentials.keySecret}`).toString("base64")}`;

  async function request<S extends z.ZodType>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    schema: S,
    body?: Record<string, unknown>,
  ): Promise<z.output<S>> {
    const response = await fetchImpl(`${API_BASE}${path}`, {
      method,
      headers: {
        authorization,
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsedError = razorpayErrorSchema.safeParse(json);
      const description = parsedError.success ? parsedError.data.error.description : undefined;
      throw new RazorpayApiError(
        response.status,
        description ?? `Razorpay request failed with HTTP ${response.status}`,
        parsedError.success ? parsedError.data.error.code : undefined,
      );
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new RazorpayApiError(502, `Unexpected Razorpay response for ${method} ${path}: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  return {
    get: <S extends z.ZodType>(path: string, schema: S) => request("GET", path, schema),
    post: <S extends z.ZodType>(path: string, schema: S, body: Record<string, unknown>) =>
      request("POST", path, schema, body),
    patch: <S extends z.ZodType>(path: string, schema: S, body: Record<string, unknown>) =>
      request("PATCH", path, schema, body),
  };
}

export type RazorpayClient = ReturnType<typeof createRazorpayClient>;

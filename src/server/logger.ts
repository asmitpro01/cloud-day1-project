import "server-only";
import { isProductionRuntime } from "@/env/runtime";

type Level = "debug" | "info" | "warn" | "error";
type Meta = Record<string, unknown>;

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel: Level = isProductionRuntime ? "info" : "debug";

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack, cause: serializeError(error.cause) };
  }
  return error;
}

function write(level: Level, message: string, meta?: Meta): void {
  if (LEVELS[level] < LEVELS[minLevel]) return;
  const entry = {
    level,
    time: new Date().toISOString(),
    message,
    ...Object.fromEntries(Object.entries(meta ?? {}).map(([key, value]) => [key, serializeError(value)])),
  };
  // One JSON object per line, which Vercel, Docker and most log drains parse natively.
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** Structured logger. Never log secrets, OTP codes, full card or bank details. */
export const logger = {
  debug: (message: string, meta?: Meta) => write("debug", message, meta),
  info: (message: string, meta?: Meta) => write("info", message, meta),
  warn: (message: string, meta?: Meta) => write("warn", message, meta),
  error: (message: string, meta?: Meta) => write("error", message, meta),
};

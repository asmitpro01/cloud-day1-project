import { z } from "zod";

export type ActionError = {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

/** What every server action returns. Actions never throw to the client. */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(
  code: string,
  message: string,
  fieldErrors?: ActionError["fieldErrors"],
): { ok: false; error: ActionError } {
  return fieldErrors ? { ok: false, error: { code, message, fieldErrors } } : { ok: false, error: { code, message } };
}

/** Converts a zod error into a `VALIDATION` failure with per-field messages. */
export function failValidation(error: z.ZodError): { ok: false; error: ActionError } {
  const { fieldErrors } = z.flattenError(error);
  return fail("VALIDATION", "Please fix the highlighted fields", fieldErrors);
}

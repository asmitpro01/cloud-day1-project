import { z } from "zod";

const pageSchema = z.coerce.number().int().min(1).max(10_000).catch(1);
const querySchema = z.string().trim().max(100).catch("");

type RawSearchParams = Record<string, string | string[] | undefined>;

/** Reads `?page=` and `?q=` safely; bad values fall back to defaults instead of erroring. */
export function parseListParams(params: RawSearchParams): { page: number; query: string } {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  return { page: pageSchema.parse(first(params.page)), query: querySchema.parse(first(params.q) ?? "") };
}

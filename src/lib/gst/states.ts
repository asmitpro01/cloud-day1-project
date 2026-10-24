import { z } from "zod";

/**
 * Indian states and union territories with their GST state codes (the first two
 * digits of a GSTIN). Legacy codes 25 (Daman & Diu, merged into 26 in 2020) and
 * 28 (undivided Andhra Pradesh) are not offered for new addresses.
 *
 * `kind` decides the intra-state tax pair: states and UTs with a legislature
 * levy SGST; UTs without a legislature levy UTGST (UTGST Act, 2017).
 */
export const GST_STATES = [
  { code: "01", name: "Jammu and Kashmir", kind: "ut-with-legislature" },
  { code: "02", name: "Himachal Pradesh", kind: "state" },
  { code: "03", name: "Punjab", kind: "state" },
  { code: "04", name: "Chandigarh", kind: "ut" },
  { code: "05", name: "Uttarakhand", kind: "state" },
  { code: "06", name: "Haryana", kind: "state" },
  { code: "07", name: "Delhi", kind: "ut-with-legislature" },
  { code: "08", name: "Rajasthan", kind: "state" },
  { code: "09", name: "Uttar Pradesh", kind: "state" },
  { code: "10", name: "Bihar", kind: "state" },
  { code: "11", name: "Sikkim", kind: "state" },
  { code: "12", name: "Arunachal Pradesh", kind: "state" },
  { code: "13", name: "Nagaland", kind: "state" },
  { code: "14", name: "Manipur", kind: "state" },
  { code: "15", name: "Mizoram", kind: "state" },
  { code: "16", name: "Tripura", kind: "state" },
  { code: "17", name: "Meghalaya", kind: "state" },
  { code: "18", name: "Assam", kind: "state" },
  { code: "19", name: "West Bengal", kind: "state" },
  { code: "20", name: "Jharkhand", kind: "state" },
  { code: "21", name: "Odisha", kind: "state" },
  { code: "22", name: "Chhattisgarh", kind: "state" },
  { code: "23", name: "Madhya Pradesh", kind: "state" },
  { code: "24", name: "Gujarat", kind: "state" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu", kind: "ut" },
  { code: "27", name: "Maharashtra", kind: "state" },
  { code: "29", name: "Karnataka", kind: "state" },
  { code: "30", name: "Goa", kind: "state" },
  { code: "31", name: "Lakshadweep", kind: "ut" },
  { code: "32", name: "Kerala", kind: "state" },
  { code: "33", name: "Tamil Nadu", kind: "state" },
  { code: "34", name: "Puducherry", kind: "ut-with-legislature" },
  { code: "35", name: "Andaman and Nicobar Islands", kind: "ut" },
  { code: "36", name: "Telangana", kind: "state" },
  { code: "37", name: "Andhra Pradesh", kind: "state" },
  { code: "38", name: "Ladakh", kind: "ut" },
  { code: "97", name: "Other Territory", kind: "ut" },
] as const;

export type GstState = (typeof GST_STATES)[number];
export type GstStateCode = GstState["code"];

const BY_CODE: ReadonlyMap<string, GstState> = new Map(GST_STATES.map((state) => [state.code, state]));

export const GST_STATE_CODES = GST_STATES.map((state) => state.code);

export function isGstStateCode(value: string): value is GstStateCode {
  return BY_CODE.has(value);
}

export function getGstState(code: GstStateCode): GstState {
  const state = BY_CODE.get(code);
  if (!state) throw new RangeError(`Unknown GST state code ${code}`);
  return state;
}

/** True when an intra-state supply in this state/UT levies UTGST instead of SGST. */
export function leviesUtgst(code: GstStateCode): boolean {
  return getGstState(code).kind === "ut";
}

/** Zod schema for a GST state code that keeps the `GstStateCode` type. */
export const gstStateCodeSchema = z.custom<GstStateCode>(
  (value) => typeof value === "string" && isGstStateCode(value),
  "Choose a valid state",
);

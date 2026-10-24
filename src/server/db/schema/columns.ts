import { bigint, timestamp } from "drizzle-orm/pg-core";

/** `timestamptz` column; every timestamp in the app is stored in UTC with time zone. */
export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** Money column: integer paise in a `bigint` (safe up to ₹90 lakh crore as a JS number). */
export const paiseColumn = (name: string) => bigint(name, { mode: "number" });

export const createdAt = () => timestamptz("created_at").notNull().defaultNow();
export const updatedAt = () =>
  timestamptz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

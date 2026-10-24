import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { user } from "@/server/db/schema";

/** Grants the admin role: `pnpm admin:grant founder@example.com` */
async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error("Usage: pnpm admin:grant <email>");
  const [updated] = await getDb()
    .update(user)
    .set({ role: "admin" })
    .where(eq(user.email, email))
    .returning({ id: user.id });
  if (!updated) throw new Error(`No user with email ${email}. Sign up first, then run this again.`);
  console.log(`✓ ${email} is now an admin`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("✗", error instanceof Error ? error.message : error);
    process.exit(1);
  });

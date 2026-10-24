import { toCsv } from "@/lib/csv";
import { formatDateTimeIST } from "@/lib/dates";
import { allWaitlistEntries } from "@/server/admin/queries";
import { getCurrentUser } from "@/server/auth/session";

/** Waitlist as CSV for admins. Cells are escaped against spreadsheet formula injection. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.isAdmin) return Response.json({ error: "Not found" }, { status: 404 });

  const entries = await allWaitlistEntries();
  const csv = toCsv(entries, [
    { header: "Name", value: (entry) => entry.name },
    { header: "Email", value: (entry) => entry.email },
    { header: "Source", value: (entry) => entry.source },
    { header: "Joined (IST)", value: (entry) => formatDateTimeIST(entry.createdAt) },
    { header: "Confirmation sent", value: (entry) => (entry.confirmationSentAt ? "yes" : "no") },
  ]);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="waitlist-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

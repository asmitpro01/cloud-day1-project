import { headers } from "next/headers";
import { buildDataExport } from "@/server/account/export";
import { getAuth } from "@/server/auth/auth";

/** DPDP right to access: a JSON download of everything we hold about the signed-in user. */
export async function GET() {
  // Read the request first: it marks this handler dynamic before any runtime config is touched.
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const data = await buildDataExport(session.user.id);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="my-data-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
